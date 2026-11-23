use serde::Deserialize;

use crate::lang::Lang;
use crate::model::{Context, Table};
use crate::table::detect_table;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Format {
    Csv,
    Markdown,
}

/// The list separator spreadsheets expect in this language: where the
/// decimal mark is a comma, Excel splits CSV fields on semicolons.
fn separator(lang: Lang) -> char {
    match lang {
        Lang::Fr => ';',
        Lang::En => ',',
    }
}

fn csv_cell(text: &str, separator: char) -> String {
    if text.contains([separator, '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

fn markdown_cell(text: &str) -> String {
    text.replace('|', "\\|").replace('\n', " ")
}

pub fn export(table: &Table, format: Format, lang: Lang) -> String {
    let names: Vec<&str> = table.columns.iter().map(|c| c.name.as_str()).collect();
    let width = names.len();
    let row_cells = |row: &[crate::model::Value], raw: bool| -> Vec<String> {
        (0..width)
            .map(|c| {
                row.get(c)
                    .map(|v| {
                        if raw {
                            v.raw.clone()
                        } else {
                            v.display.clone()
                        }
                    })
                    .unwrap_or_default()
            })
            .collect()
    };
    match format {
        Format::Csv => {
            let separator = separator(lang);
            let join = |cells: Vec<String>| cells.join(&separator.to_string());
            let mut lines = vec![join(names.iter().map(|n| csv_cell(n, separator)).collect())];
            lines.extend(table.rows.iter().map(|row| {
                join(
                    row_cells(row, true)
                        .iter()
                        .map(|c| csv_cell(c, separator))
                        .collect(),
                )
            }));
            lines.join("\r\n") + "\r\n"
        }
        Format::Markdown => {
            let line = |cells: Vec<String>| format!("| {} |", cells.join(" | "));
            let mut lines = vec![
                line(names.iter().map(|n| markdown_cell(n)).collect()),
                line(vec!["---".to_string(); width]),
            ];
            lines.extend(table.rows.iter().map(|row| {
                line(
                    row_cells(row, false)
                        .iter()
                        .map(|c| markdown_cell(c))
                        .collect(),
                )
            }));
            lines.join("\n")
        }
    }
}

fn separator_of(text: &str) -> char {
    let mut quoted = false;
    let (mut semicolons, mut commas) = (0, 0);
    for c in text.chars() {
        match c {
            '"' => quoted = !quoted,
            '\n' if !quoted => break,
            ';' if !quoted => semicolons += 1,
            ',' if !quoted => commas += 1,
            _ => {}
        }
    }
    if semicolons > commas { ';' } else { ',' }
}

fn csv_rows(text: &str) -> Vec<Vec<String>> {
    let separator = separator_of(text);
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            ('"', true) => quoted = false,
            ('"', false) if field.is_empty() => quoted = true,
            (c, false) if c == separator => row.push(std::mem::take(&mut field)),
            ('\r', false) => {}
            ('\n', false) => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            (c, _) => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

pub fn import_csv(text: &str, context: Context) -> Option<Table> {
    let tsv = csv_rows(text.trim_start_matches('\u{feff}'))
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| cell.replace(['\t', '\n', '\r'], " "))
                .collect::<Vec<_>>()
                .join("\t")
        })
        .collect::<Vec<_>>()
        .join("\n");
    detect_table(&tsv, context).map(|(table, _)| table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lang::Lang;
    use crate::values::Day;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: Lang::Fr,
    };

    fn sample() -> Table {
        detect_table(
            "Client\tMontant\tNote\nPaul, fils\t1 200,50 €\ta \"b\"\nAnne\t850 €\tx|y",
            CONTEXT,
        )
        .map(|(table, _)| table)
        .unwrap_or_else(|| unreachable!("table"))
    }

    #[test]
    fn exports_csv_with_what_was_typed() {
        assert_eq!(
            export(&sample(), Format::Csv, Lang::En),
            "Client,Montant,Note\r\n\"Paul, fils\",\"1 200,50 €\",\"a \"\"b\"\"\"\r\nAnne,850 €,x|y\r\n"
        );
    }

    #[test]
    fn exports_french_csv_with_semicolons_as_excel_expects() {
        assert_eq!(
            export(&sample(), Format::Csv, Lang::Fr),
            "Client;Montant;Note\r\nPaul, fils;1 200,50 €;\"a \"\"b\"\"\"\r\nAnne;850 €;x|y\r\n"
        );
    }

    #[test]
    fn imports_a_french_excel_csv() {
        let table = import_csv(
            "\u{feff}Mois;Montant\r\njanvier;1 200,50 €\r\nfévrier;\"3 000,00 €\"\r\n",
            CONTEXT,
        )
        .unwrap_or_else(|| unreachable!("csv"));
        assert_eq!(table.columns[0].name, "Mois");
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[1][1].display, "3\u{202f}000,00\u{a0}€");
    }

    #[test]
    fn exports_markdown_with_what_is_shown() {
        assert_eq!(
            export(&sample(), Format::Markdown, Lang::Fr),
            "| Client | Montant | Note |\n| --- | --- | --- |\n| Paul, fils | 1\u{202f}200,50\u{a0}€ | a \"b\" |\n| Anne | 850,00\u{a0}€ | x\\|y |"
        );
    }

    #[test]
    fn a_csv_export_reads_back_as_the_same_table() {
        let table = sample();
        for lang in [Lang::Fr, Lang::En] {
            let again = import_csv(&export(&table, Format::Csv, lang), CONTEXT)
                .unwrap_or_else(|| unreachable!("csv"));
            assert_eq!(again, table);
        }
    }

    #[test]
    fn imports_a_spreadsheet_csv() {
        let table = import_csv(
            "Date,Total\n12/03/2026,\"1 200,50 €\"\n15/03/2026,850 €\n",
            CONTEXT,
        )
        .unwrap_or_else(|| unreachable!("csv"));
        assert_eq!(table.columns[0].property, crate::model::PropertyType::Date);
        assert_eq!(table.rows[0][1].display, "1\u{202f}200,50\u{a0}€");
    }
}
