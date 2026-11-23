use crate::lang::{Labels, Lang, lang_of};
use crate::model::{Column, Context, PropertyType, Table, Value, infer_property, type_value};
use crate::table::{values, words};

const MAX_RECORD_WORDS: usize = 6;

#[derive(Debug, PartialEq)]
enum Run {
    Text(String),
    Value(String),
}

fn is_value(text: &str, context: Context) -> bool {
    infer_property(&[text], context) != PropertyType::Text
}

fn conjunctions() -> impl Iterator<Item = &'static str> {
    Lang::ALL.iter().map(|lang| lang.data().and)
}

fn without_leading_conjunction(segment: &str) -> &str {
    conjunctions()
        .find_map(|and| {
            segment
                .strip_prefix(and)
                .and_then(|rest| rest.strip_prefix(' '))
        })
        .unwrap_or(segment)
        .trim()
}

fn last_conjunction(text: &str) -> Option<(usize, usize)> {
    conjunctions()
        .filter_map(|and| {
            text.rfind(&format!(" {and} "))
                .map(|at| (at, and.len() + 2))
        })
        .max_by_key(|(at, _)| *at)
}

fn split_on_conjunctions(text: &str, every: bool) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut rest = text;
    while let Some((at, len)) = last_conjunction(rest) {
        parts.push(rest[at + len..].trim());
        rest = rest[..at].trim();
        if !every {
            break;
        }
    }
    parts.push(rest);
    parts.reverse();
    parts
}

fn split_candidates(line: &str) -> Vec<Vec<&str>> {
    let line = line.trim().trim_end_matches(['.', '!', '…']);
    let segments: Vec<&str> = line
        .split("; ")
        .flat_map(|part| part.split(", "))
        .map(|part| without_leading_conjunction(part.trim().trim_end_matches([',', ';'])))
        .filter(|part| !part.is_empty())
        .collect();
    let Some((last, head)) = segments.split_last() else {
        return Vec::new();
    };
    [true, false]
        .into_iter()
        .map(|every| {
            let mut candidate = head.to_vec();
            candidate.extend(split_on_conjunctions(last, every));
            candidate
        })
        .chain(std::iter::once(segments.clone()))
        .collect()
}

fn unglue(token: &str) -> Vec<String> {
    let split = token.find(|c: char| c.is_ascii_digit());
    match split {
        Some(at)
            if at > 0
                && token[..at].chars().all(char::is_alphabetic)
                && token[at..].chars().all(|c| c.is_ascii_digit()) =>
        {
            vec![token[..at].to_string(), token[at..].to_string()]
        }
        _ => vec![token.to_string()],
    }
}

fn runs(segment: &str, context: Context, glued: bool) -> Option<Vec<Run>> {
    let tokens: Vec<String> = values(words(segment))
        .into_iter()
        .flat_map(|w| if glued { unglue(&w.text) } else { vec![w.text] })
        .collect();
    if tokens.is_empty() || tokens.len() > MAX_RECORD_WORDS {
        return None;
    }
    let mut out: Vec<Run> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let pair = tokens
            .get(i + 1)
            .map(|next| format!("{} {next}", tokens[i]));
        let value = if is_value(&tokens[i], context) {
            Some((tokens[i].clone(), 1))
        } else {
            pair.filter(|pair| is_value(pair, context))
                .map(|pair| (pair, 2))
        };
        match (value, out.last_mut()) {
            (Some((text, used)), _) => {
                out.push(Run::Value(text));
                i += used;
                continue;
            }
            (None, Some(Run::Text(text))) => {
                text.push(' ');
                text.push_str(&tokens[i]);
            }
            (None, _) => out.push(Run::Text(tokens[i].clone())),
        }
        i += 1;
    }
    Some(out)
}

fn column_name(property: PropertyType, first_text: bool, labels: &Labels) -> &'static str {
    match property {
        PropertyType::Text if first_text => labels.name,
        PropertyType::Text => labels.text,
        PropertyType::Number => labels.number,
        PropertyType::Money { .. } => labels.amount,
        PropertyType::Percent => labels.percent,
        PropertyType::Date => labels.date,
        PropertyType::Checkbox => labels.done,
    }
}

fn unique_names(properties: &[PropertyType], labels: &Labels) -> Vec<String> {
    let mut seen_text = false;
    let mut names: Vec<String> = Vec::new();
    for property in properties {
        let base = column_name(*property, !seen_text, labels);
        seen_text |= *property == PropertyType::Text;
        let count = names
            .iter()
            .filter(|n| n.split(' ').next() == Some(base))
            .count();
        names.push(if count == 0 {
            base.to_string()
        } else {
            format!("{base} {}", count + 1)
        });
    }
    names
}

pub fn detect_records(line: &str, context: Context) -> Option<Table> {
    let language = lang_of(line, context.lang).data();
    split_candidates(line)
        .iter()
        .filter(|segments| segments.len() >= 2)
        .flat_map(|segments| [false, true].map(|glued| (segments, glued)))
        .find_map(|(segments, glued)| records_table(segments, context, glued, &language.labels))
}

fn records_table(
    segments: &[&str],
    context: Context,
    glued: bool,
    labels: &Labels,
) -> Option<Table> {
    let rows: Vec<Vec<Run>> = segments
        .iter()
        .map(|segment| runs(segment, context, glued))
        .collect::<Option<_>>()?;
    let width = rows.first()?.len();
    if width < 2 || rows.iter().any(|row| row.len() != width) {
        return None;
    }
    let always_a_value = (0..width).any(|c| rows.iter().all(|row| matches!(row[c], Run::Value(_))));
    if !always_a_value {
        return None;
    }
    let cells: Vec<Vec<&str>> = rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|run| match run {
                    Run::Text(text) | Run::Value(text) => text.as_str(),
                })
                .collect()
        })
        .collect();
    let properties: Vec<PropertyType> = (0..width)
        .map(|c| infer_property(&cells.iter().map(|row| row[c]).collect::<Vec<_>>(), context))
        .collect();
    let columns = unique_names(&properties, labels)
        .into_iter()
        .zip(&properties)
        .map(|(name, property)| Column::new(name, *property))
        .collect();
    let rows = cells
        .iter()
        .map(|row| {
            row.iter()
                .zip(&properties)
                .map(|(cell, property)| type_value(cell, *property, context))
                .collect()
        })
        .collect();
    Some(Table { columns, rows })
}

pub fn rows_for(table: &Table, line: &str, context: Context) -> Option<Vec<Vec<Value>>> {
    let width = table.columns.len();
    if width < 2 {
        return None;
    }
    split_candidates(line)
        .iter()
        .flat_map(|segments| [false, true].map(|glued| (segments, glued)))
        .find_map(|(segments, glued)| fitted_rows(table, segments, context, glued))
}

fn fitted_rows(
    table: &Table,
    segments: &[&str],
    context: Context,
    glued: bool,
) -> Option<Vec<Vec<Value>>> {
    let width = table.columns.len();
    segments
        .iter()
        .map(|segment| {
            let runs = runs(segment, context, glued).filter(|runs| runs.len() == width)?;
            runs.iter()
                .zip(&table.columns)
                .map(|(run, column)| {
                    let (Run::Text(text) | Run::Value(text)) = run;
                    let value = type_value(text, column.property, context);
                    let fits = column.property == PropertyType::Text || value.typed.is_some();
                    fits.then_some(value)
                })
                .collect::<Option<Vec<Value>>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::values::Day;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };

    fn grid(line: &str) -> Option<(Vec<String>, Vec<Vec<String>>)> {
        detect_records(line, CONTEXT).map(|table| {
            (
                table.columns.iter().map(|c| c.name.clone()).collect(),
                table
                    .rows
                    .iter()
                    .map(|row| row.iter().map(|v| v.raw.clone()).collect())
                    .collect(),
            )
        })
    }

    #[test]
    fn reads_records_written_on_one_line() {
        let (names, rows) = grid("paul 10 le lundi, fred 20 le mercredi, jean 100 demain")
            .unwrap_or_else(|| unreachable!("records"));
        assert_eq!(names, ["Nom", "Nombre", "Date"]);
        assert_eq!(rows[0], ["paul", "10", "le lundi"]);
        assert_eq!(rows[2], ["jean", "100", "demain"]);
    }

    #[test]
    fn keeps_a_misspelled_day_as_a_cell() {
        let (names, rows) = grid("paul 10 le lundi, fred 20 le mercerid, jean 100 demain")
            .unwrap_or_else(|| unreachable!("records"));
        assert_eq!(names, ["Nom", "Nombre", "Texte"]);
        assert_eq!(rows[1], ["fred", "20", "le mercerid"]);
    }

    #[test]
    fn reads_amounts_and_a_final_et() {
        let (names, rows) = grid("Café 2,50 €, croissant 1,20 € et jus 3 €")
            .unwrap_or_else(|| unreachable!("records"));
        assert_eq!(names, ["Nom", "Montant"]);
        assert_eq!(rows[1], ["croissant", "1,20 €"]);
        assert_eq!(rows[2], ["jus", "3 €"]);
    }

    #[test]
    fn appends_lines_written_under_a_table() {
        let table = detect_records("janvier 1 200 €, février 900 €", CONTEXT)
            .unwrap_or_else(|| unreachable!("table"));
        let rows = rows_for(&table, "mars 1 500 € et avril 800 €", CONTEXT)
            .unwrap_or_else(|| unreachable!("rows"));
        let raws: Vec<Vec<&str>> = rows
            .iter()
            .map(|row| row.iter().map(|v| v.raw.as_str()).collect())
            .collect();
        assert_eq!(raws, [["mars", "1 500 €"], ["avril", "800 €"]]);
        assert!(rows[0][1].typed.is_some());
        assert_eq!(rows_for(&table, "mars sera un bon mois", CONTEXT), None);
        assert_eq!(rows_for(&table, "1 500 € mars", CONTEXT), None);
    }

    #[test]
    fn reads_english_records() {
        let (names, rows) = grid("Paul 10 on Monday, Fred 20 tomorrow and the shop 5 today")
            .unwrap_or_else(|| unreachable!("records"));
        assert_eq!(names, ["Name", "Number", "Date"]);
        assert_eq!(rows[2], ["the shop", "5", "today"]);
    }

    #[test]
    fn ends_a_list_with_and_like_people_do() {
        let names = |line: &str| {
            grid(line).map(|(_, rows)| rows.iter().map(|row| row.join(" ")).collect::<Vec<_>>())
        };
        assert_eq!(
            names("paul 1 et fred 2"),
            Some(vec!["paul 1".into(), "fred 2".into()])
        );
        assert_eq!(
            names("paul 1 and fred 2"),
            Some(vec!["paul 1".into(), "fred 2".into()])
        );
        assert_eq!(
            names("x 1, x 2 et x 3"),
            Some(vec!["x 1".into(), "x 2".into(), "x 3".into()])
        );
        assert_eq!(
            names("x 1, x 2, and x 3"),
            Some(vec!["x 1".into(), "x 2".into(), "x 3".into()])
        );
        assert_eq!(
            names("paul 1 et fred 2 et jean 3"),
            Some(vec!["paul 1".into(), "fred 2".into(), "jean 3".into()])
        );
        assert_eq!(
            names("x 1, x 2 et x3"),
            Some(vec!["x 1".into(), "x 2".into(), "x 3".into()])
        );
        assert_eq!(
            names("café 2 €, pain et beurre 3 €"),
            Some(vec!["café 2 €".into(), "pain et beurre 3 €".into()])
        );
    }

    #[test]
    fn leaves_prose_alone() {
        for line in [
            "Hier, nous avons acheté 3 pommes, 2 poires et 5 kiwis.",
            "Bonjour, merci pour ton message, à demain",
            "paul, fred, jean",
            "Il faut 10 minutes, peut-être plus si la route est mauvaise ce soir",
        ] {
            assert_eq!(grid(line), None, "{line:?}");
        }
    }
}
