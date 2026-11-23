use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::iter::once;

use serde::Serialize;

use crate::model::{Column, Context, PropertyType, Table, infer_property, type_value};
use crate::values::parse_decimal;

const UNIT_TOKENS: [&str; 9] = ["€", "$", "£", "%", "EUR", "USD", "GBP", "CHF", "US$"];
const ALIGN_TOLERANCE: usize = 1;
const MIN_TYPED_COLUMNS_WITHOUT_SEPARATOR: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Certain,
    Likely,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Separator {
    Tab,
    Pipe,
    Semicolon,
    Dash(&'static str),
    Spaces,
    Values,
}

impl Separator {
    fn confidence(self) -> Confidence {
        match self {
            Separator::Tab | Separator::Pipe => Confidence::Certain,
            Separator::Semicolon | Separator::Dash(_) | Separator::Spaces | Separator::Values => {
                Confidence::Likely
            }
        }
    }

    fn split(self, line: &str) -> Vec<String> {
        let cells: Vec<&str> = match self {
            Separator::Tab => line.split('\t').collect(),
            Separator::Pipe => line
                .trim()
                .trim_start_matches('|')
                .trim_end_matches('|')
                .split('|')
                .collect(),
            Separator::Semicolon => line.split(';').collect(),
            Separator::Dash(dash) => line.split(dash).collect(),
            Separator::Spaces => split_on_wide_gaps(line),
            Separator::Values => vec![line],
        };
        cells
            .into_iter()
            .map(|cell| cell.trim().to_string())
            .collect()
    }

    fn present_in(self, line: &str) -> bool {
        match self {
            Separator::Tab => line.contains('\t'),
            Separator::Pipe => line.contains('|'),
            Separator::Semicolon => line.contains(';'),
            Separator::Dash(dash) => line.contains(dash),
            Separator::Spaces => split_on_wide_gaps(line).len() > 1,
            Separator::Values => false,
        }
    }
}

const SEPARATORS: [Separator; 7] = [
    Separator::Tab,
    Separator::Pipe,
    Separator::Semicolon,
    Separator::Dash(" — "),
    Separator::Dash(" – "),
    Separator::Dash(" - "),
    Separator::Spaces,
];

fn split_on_wide_gaps(line: &str) -> Vec<&str> {
    let line = line.trim();
    let mut cells = Vec::new();
    let mut start = 0;
    let mut gap_start: Option<usize> = None;
    let mut gap_len = 0;
    for (at, c) in line.char_indices() {
        if c == ' ' || c == '\u{a0}' {
            gap_start.get_or_insert(at);
            gap_len += 1;
            continue;
        }
        if let Some(gap) = gap_start.take()
            && gap_len >= 2
        {
            cells.push(&line[start..gap]);
            start = at;
        }
        gap_len = 0;
    }
    cells.push(&line[start..]);
    cells
}

pub(crate) struct Word {
    column: usize,
    pub(crate) text: String,
}

pub(crate) fn words(line: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut current: Option<Word> = None;
    for (column, c) in line.chars().enumerate() {
        if c.is_whitespace() {
            words.extend(current.take());
        } else {
            current
                .get_or_insert_with(|| Word {
                    column,
                    text: String::new(),
                })
                .text
                .push(c);
        }
    }
    words.extend(current);
    words
}

fn leads_thousands(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);
    (1..=3).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
}

fn continues_thousands(text: &str) -> bool {
    let (group, rest) = text.split_at(text.len().min(3));
    let fraction_ok = rest.is_empty()
        || (rest.starts_with([',', '.'])
            && rest.len() > 1
            && rest[1..].bytes().all(|b| b.is_ascii_digit()));
    group.len() == 3 && group.bytes().all(|b| b.is_ascii_digit()) && fraction_ok
}

pub(crate) fn values(words: Vec<Word>) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    for word in words {
        let is_unit = UNIT_TOKENS
            .iter()
            .any(|unit| word.text.eq_ignore_ascii_case(unit));
        let after_number = out
            .last()
            .is_some_and(|prev| parse_decimal(&prev.text).is_some());
        if !(is_unit && after_number) {
            out.push(word);
            continue;
        }
        let mut start = out.len() - 1;
        while start > 0
            && leads_thousands(&out[start - 1].text)
            && continues_thousands(&out[start].text)
        {
            start -= 1;
        }
        let merged: Vec<Word> = out.drain(start..).chain(once(word)).collect();
        let column = merged.first().map_or(0, |w| w.column);
        let text = merged
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        out.push(Word { column, text });
    }
    out
}

fn most_frequent(columns: impl Iterator<Item = usize>) -> usize {
    let mut counts: BTreeMap<usize, usize> = BTreeMap::new();
    for column in columns {
        *counts.entry(column).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by(|(a, ca), (b, cb)| ca.cmp(cb).then(b.cmp(a)))
        .map_or(0, |(column, _)| column)
}

fn align_to_columns(words: &[Word], starts: &[usize]) -> Option<Vec<String>> {
    let mut cells = vec![String::new(); starts.len()];
    for word in words {
        let index = starts
            .iter()
            .rposition(|start| *start <= word.column + ALIGN_TOLERANCE)
            .unwrap_or(0);
        let cell = cells.get_mut(index)?;
        if !cell.is_empty() {
            cell.push(' ');
        }
        cell.push_str(&word.text);
    }
    cells.iter().all(|cell| !cell.is_empty()).then_some(cells)
}

fn values_grid(lines: &[&str]) -> Option<Vec<Vec<String>>> {
    let rows: Vec<Vec<Word>> = lines.iter().map(|line| values(words(line))).collect();
    let (first, body) = rows.split_first()?;
    let width = body.first()?.len();
    if width < 2 || body.iter().any(|row| row.len() != width) {
        return None;
    }
    let texts = |row: &[Word]| row.iter().map(|w| w.text.clone()).collect::<Vec<_>>();
    let header = match first.len().cmp(&width) {
        Ordering::Equal => texts(first),
        Ordering::Greater => {
            let starts: Vec<usize> = (0..width)
                .map(|c| most_frequent(body.iter().filter_map(|row| row.get(c)).map(|w| w.column)))
                .collect();
            align_to_columns(first, &starts)?
        }
        Ordering::Less => return None,
    };
    Some(
        once(header)
            .chain(body.iter().map(|row| texts(row)))
            .collect(),
    )
}

fn is_markdown_rule(cells: &[String]) -> bool {
    cells.iter().all(|cell| {
        let core = cell.trim_matches(':');
        !core.is_empty() && core.chars().all(|c| c == '-')
    })
}

struct Grid {
    rows: Vec<Vec<String>>,
    separator: Separator,
    markdown_header: bool,
}

fn grid_of(lines: &[&str]) -> Option<Grid> {
    split_grid(lines).or_else(|| {
        values_grid(lines).map(|rows| Grid {
            rows,
            separator: Separator::Values,
            markdown_header: false,
        })
    })
}

fn split_grid(lines: &[&str]) -> Option<Grid> {
    SEPARATORS.into_iter().find_map(|separator| {
        if !lines.iter().all(|line| separator.present_in(line)) {
            return None;
        }
        let mut rows: Vec<Vec<String>> = lines.iter().map(|line| separator.split(line)).collect();
        let markdown_header =
            separator == Separator::Pipe && rows.get(1).is_some_and(|row| is_markdown_rule(row));
        if markdown_header {
            rows.remove(1);
        }
        let width = rows.iter().map(Vec::len).max()?;
        let ragged = rows.iter().any(|row| row.len() != width);
        if width < 2 || rows.len() < 2 || (ragged && separator != Separator::Tab) {
            return None;
        }
        for row in &mut rows {
            row.resize(width, String::new());
        }
        Some(Grid {
            rows,
            separator,
            markdown_header,
        })
    })
}

fn column(rows: &[Vec<String>], index: usize) -> Vec<&str> {
    rows.iter()
        .map(|row| row.get(index).map(String::as_str).unwrap_or(""))
        .collect()
}

fn first_row_is_header(grid: &Grid, context: Context) -> bool {
    if grid.markdown_header {
        return true;
    }
    let (first, body) = match grid.rows.split_first() {
        Some(split) => split,
        None => return false,
    };
    if first.iter().any(|cell| cell.is_empty()) {
        return false;
    }
    let mut typed_columns = 0;
    for (index, cell) in first.iter().enumerate() {
        let property = infer_property(&column(body, index), context);
        if property == PropertyType::Text {
            continue;
        }
        typed_columns += 1;
        if type_value(cell, property, context).typed.is_none() {
            return true;
        }
    }
    typed_columns == 0 && grid.separator == Separator::Tab
}

pub fn detect_table(text: &str, context: Context) -> Option<(Table, Confidence)> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.len() < 2 {
        return None;
    }
    let grid = grid_of(&lines)?;
    let header = first_row_is_header(&grid, context);
    let (names, body): (Vec<String>, &[Vec<String>]) = if header {
        (grid.rows[0].clone(), &grid.rows[1..])
    } else {
        (
            (1..=grid.rows[0].len())
                .map(|i| format!("Colonne {i}"))
                .collect(),
            &grid.rows[..],
        )
    };
    let properties: Vec<PropertyType> = (0..names.len())
        .map(|i| infer_property(&column(body, i), context))
        .collect();
    let confidence = grid.separator.confidence();
    let typed_columns = properties
        .iter()
        .filter(|p| **p != PropertyType::Text)
        .count();
    let min_typed = match grid.separator {
        Separator::Values => MIN_TYPED_COLUMNS_WITHOUT_SEPARATOR,
        _ if confidence == Confidence::Likely => 1,
        _ => 0,
    };
    if typed_columns < min_typed {
        return None;
    }
    let rows = body
        .iter()
        .map(|row| {
            row.iter()
                .zip(&properties)
                .map(|(cell, property)| type_value(cell, *property, context))
                .collect()
        })
        .collect();
    let columns = names
        .into_iter()
        .zip(properties)
        .map(|(name, property)| Column::new(name, property))
        .collect();
    Some((Table { columns, rows }, confidence))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Typed;
    use crate::values::{Currency, Day};

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };

    fn properties(table: &Table) -> Vec<PropertyType> {
        table.columns.iter().map(|c| c.property).collect()
    }

    #[test]
    fn reads_a_spreadsheet_paste() {
        let text = "Client\tDate\tMontant\tPayé\nPaul\t12/03/2026\t1 200,50 €\toui\nAnne\t15/03/2026\t850 €\tnon\n";
        let Some((table, confidence)) = detect_table(text, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(confidence, Confidence::Certain);
        assert_eq!(
            table
                .columns
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["Client", "Date", "Montant", "Payé"]
        );
        assert_eq!(
            properties(&table),
            [
                PropertyType::Text,
                PropertyType::Date,
                PropertyType::Money {
                    currency: Currency::Eur
                },
                PropertyType::Checkbox
            ]
        );
        assert_eq!(table.rows.len(), 2);
        assert_eq!(
            table.rows[1][2].typed,
            Some(Typed::Money {
                minor: 85000,
                currency: Currency::Eur
            })
        );
    }

    #[test]
    fn reads_lines_typed_by_hand_as_a_likely_table() {
        let text = "Paul — 12/03 — 1 200 €\nAnne — 15/03 — 850 €";
        let Some((table, confidence)) = detect_table(text, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(confidence, Confidence::Likely);
        assert_eq!(table.columns[0].name, "Colonne 1");
        assert_eq!(table.rows.len(), 2);
        assert_eq!(properties(&table)[1], PropertyType::Date);
    }

    #[test]
    fn reads_markdown_and_semicolons() {
        let markdown = "| Nom | Âge |\n|---|---:|\n| Paul | 34 |\n| Anne | 29 |";
        let Some((table, _)) = detect_table(markdown, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(table.columns[1].name, "Âge");
        assert_eq!(table.rows.len(), 2);

        let csv = "Produit;Prix\nCafé;2,50 €\nThé;3 €";
        let Some((table, _)) = detect_table(csv, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(table.columns[0].name, "Produit");
        assert_eq!(
            properties(&table)[1],
            PropertyType::Money {
                currency: Currency::Eur
            }
        );
    }

    #[test]
    fn reads_columns_aligned_with_spaces() {
        let text = "Ville      Habitants\nParis      2 100 000\nLyon       520 000";
        let Some((table, _)) = detect_table(text, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(table.columns[1].name, "Habitants");
        assert_eq!(properties(&table)[1], PropertyType::Number);
    }

    #[test]
    fn reads_a_table_whose_tabs_became_spaces() {
        let text = "Produit Prix    Stock   En vente\n\
                    Clavier 49,90 € 12      oui\n\
                    Souris  19,00 € 40      oui\n\
                    Écran   189,00 €        3       non";
        let Some((table, confidence)) = detect_table(text, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(confidence, Confidence::Likely);
        assert_eq!(
            table
                .columns
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["Produit", "Prix", "Stock", "En vente"]
        );
        assert_eq!(
            properties(&table),
            [
                PropertyType::Text,
                PropertyType::Money {
                    currency: Currency::Eur
                },
                PropertyType::Number,
                PropertyType::Checkbox
            ]
        );
        assert_eq!(table.rows[2][1].raw, "189,00 €");
        assert_eq!(table.rows[2][2].raw, "3");
    }

    #[test]
    fn reads_values_separated_by_single_spaces() {
        let Some((table, _)) = detect_table("Paul 12/03 1 200 €\nAnne 15/03 850 €", CONTEXT)
        else {
            unreachable!("not detected")
        };
        assert_eq!(table.rows[0][2].raw, "1 200 €");
        assert_eq!(properties(&table)[1], PropertyType::Date);
    }

    #[test]
    fn leaves_prose_alone() {
        for text in [
            "Une seule ligne\tavec une tabulation",
            "Je pars demain - enfin je crois\nEt toi - tu viens ?",
            "Bonjour à tous,\nVoici le compte rendu de la réunion.",
            "Paul; Anne\nMarc; Julie",
            "Je mange 3 pommes\nTu bois 2 cafés",
            "Il est 12 h\nIl est 13 h",
            "Bonjour tout le monde\nComment allez vous",
        ] {
            assert!(detect_table(text, CONTEXT).is_none(), "{text:?}");
        }
    }

    #[test]
    fn a_pasted_text_table_keeps_its_header() {
        let text = "Prénom\tVille\nPaul\tParis\nAnne\tLyon";
        let Some((table, _)) = detect_table(text, CONTEXT) else {
            unreachable!("not detected")
        };
        assert_eq!(table.columns[0].name, "Prénom");
        assert_eq!(table.rows.len(), 2);
    }
}
