use serde::Serialize;

use crate::lang::{Lang, Language};
use crate::model::{Column, PropertyType, Table, Value};

const MAX_COMMAND_WORDS: usize = 25;
const MAX_COLUMNS: usize = 20;
const MAX_ROWS: usize = 500;
const DEFAULT_COLUMNS: usize = 2;
const DEFAULT_ROWS: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CreateTable {
    pub lang: Lang,
    pub columns: usize,
    pub rows: usize,
    pub subject: Option<String>,
    pub table: Table,
}

fn fold(word: &str) -> String {
    word.to_lowercase()
        .chars()
        .map(|c| match c {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'à' | 'â' => 'a',
            'î' | 'ï' => 'i',
            'ô' => 'o',
            'û' | 'ù' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut rows = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in rows.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in rows[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (rows[i - 1][j] + 1)
                .min(rows[i][j - 1] + 1)
                .min(rows[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(rows[i - 2][j - 2] + 1);
            }
            rows[i][j] = best;
        }
    }
    rows[a.len()][b.len()]
}

fn sounds_like(word: &str, keywords: &[&str]) -> bool {
    let allowed = if word.chars().count() >= 6 { 2 } else { 1 };
    keywords
        .iter()
        .any(|k| word == *k || (word.len() >= 4 && distance(word, k) <= allowed))
}

fn number(word: &str, language: &Language) -> Option<usize> {
    word.parse().ok().or_else(|| {
        language
            .number_words
            .iter()
            .find(|(w, _)| *w == word)
            .map(|(_, n)| *n)
    })
}

fn count_before(words: &[String], at: usize, language: &Language) -> Option<usize> {
    (1..=2)
        .filter_map(|back| at.checked_sub(back))
        .find_map(|i| number(&words[i], language))
}

fn subject(original: &[&str], words: &[String], language: &Language) -> Option<String> {
    let markers = language.subject_markers;
    let start = words.iter().position(|w| markers.contains(&w.as_str()))?;
    let rest = &words[start + 1..];
    let is_dimension = |w: &String| {
        number(w, language).is_some()
            || sounds_like(w, language.column_words)
            || sounds_like(w, language.row_words)
    };
    if rest.iter().take(3).any(is_dimension) {
        let next = rest.iter().position(|w| markers.contains(&w.as_str()))?;
        return subject(
            &original[start + 1 + next..],
            &words[start + 1 + next..],
            language,
        );
    }
    let text = original[start + 1..].join(" ");
    (!text.is_empty()).then_some(text)
}

fn empty_table(columns: usize, rows: usize, language: &Language) -> Table {
    Table {
        columns: (1..=columns)
            .map(|i| {
                Column::new(
                    format!("{} {i}", language.labels.column),
                    PropertyType::Text,
                )
            })
            .collect(),
        rows: (0..rows)
            .map(|_| {
                (0..columns)
                    .map(|_| Value {
                        raw: String::new(),
                        typed: None,
                        display: String::new(),
                    })
                    .collect()
            })
            .collect(),
    }
}

pub fn detect_create_table(line: &str) -> Option<CreateTable> {
    Lang::ALL
        .iter()
        .find_map(|lang| detect_in(line, lang.data()))
}

fn detect_in(line: &str, language: &'static Language) -> Option<CreateTable> {
    let original: Vec<&str> = line
        .split(|c: char| c.is_whitespace() || matches!(c, '\'' | '’' | ',' | '.' | ':' | '?' | '!'))
        .filter(|w| !w.is_empty())
        .collect();
    if original.is_empty() || original.len() > MAX_COMMAND_WORDS {
        return None;
    }
    let words: Vec<String> = original.iter().map(|w| fold(w)).collect();
    let table_at = words
        .iter()
        .position(|w| sounds_like(w, language.table_words))?;
    if table_at > 3 {
        return None;
    }
    let dimension = |keywords: &[&str]| {
        words
            .iter()
            .enumerate()
            .skip(table_at + 1)
            .find(|(_, w)| sounds_like(w, keywords))
            .and_then(|(at, _)| count_before(&words, at, language))
    };
    let (columns, rows) = (
        dimension(language.column_words),
        dimension(language.row_words),
    );
    if columns.is_none() && rows.is_none() {
        return None;
    }
    let columns = columns.unwrap_or(DEFAULT_COLUMNS);
    let rows = rows.unwrap_or(DEFAULT_ROWS);
    if !(1..=MAX_COLUMNS).contains(&columns) || !(1..=MAX_ROWS).contains(&rows) {
        return None;
    }
    Some(CreateTable {
        lang: language.lang,
        columns,
        rows,
        subject: subject(&original, &words, language),
        table: empty_table(columns, rows, language),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(line: &str) -> Option<(usize, usize)> {
        detect_create_table(line).map(|c| (c.columns, c.rows))
    }

    #[test]
    fn reads_a_typed_command_despite_typos() {
        assert_eq!(
            size("créer un tableau de 2 colonnes avec 10 lignes"),
            Some((2, 10))
        );
        assert_eq!(
            size("créer un tableau de 2 colone avec 10 lingnes"),
            Some((2, 10))
        );
        assert_eq!(size("tablean de 2 colonnes avec 2 lingres"), Some((2, 2)));
        assert_eq!(
            size("Fais un tableau de trois colonnes"),
            Some((3, DEFAULT_ROWS))
        );
        assert_eq!(size("tableau 10 lignes"), Some((DEFAULT_COLUMNS, 10)));
    }

    #[test]
    fn keeps_what_the_table_should_show() {
        let command = detect_create_table(
            "créons un tableau avec 3 colonnes et 10 lignes montrant l avancement du profit dans une système donne",
        );
        assert_eq!(command.as_ref().map(|c| (c.columns, c.rows)), Some((3, 10)));
        assert_eq!(
            command.and_then(|c| c.subject).as_deref(),
            Some("l avancement du profit dans une système donne")
        );
    }

    #[test]
    fn builds_an_empty_table_of_that_size() {
        let command = detect_create_table("tableau de 3 colonnes et 4 lignes");
        let table = command
            .map(|c| c.table)
            .unwrap_or_else(|| unreachable!("command"));
        assert_eq!(table.columns.len(), 3);
        assert_eq!(table.rows.len(), 4);
        assert_eq!(table.columns[2].name, "Colonne 3");
    }

    #[test]
    fn reads_the_same_command_in_english() {
        assert_eq!(
            size("create a table with 3 columns and 10 rows"),
            Some((3, 10))
        );
        assert_eq!(size("tabel of two colums"), Some((2, DEFAULT_ROWS)));
        let command = detect_create_table("table with 2 columns showing the monthly revenue");
        assert_eq!(command.as_ref().map(|c| c.lang), Some(Lang::En));
        assert_eq!(
            command.as_ref().map(|c| c.table.columns[0].name.as_str()),
            Some("Column 1")
        );
        assert_eq!(
            command.and_then(|c| c.subject).as_deref(),
            Some("the monthly revenue")
        );
    }

    #[test]
    fn leaves_prose_and_huge_sizes_alone() {
        for line in [
            "Le tableau est accroché au mur du salon",
            "Il a écrit 2 lignes",
            "tableau de 900 lignes",
            "Hier soir, en rangeant le grenier, nous avons retrouvé un vieux tableau de 2 colonnes",
        ] {
            assert_eq!(size(line), None, "{line:?}");
        }
    }
}
