use serde::Serialize;

use crate::command::{CreateTable, detect_create_table};
use crate::model::{Context, PropertyType, Table, infer_property};
use crate::records::detect_records;
use crate::table::{Confidence, detect_table};

const HEADING_MAX_CHARS: usize = 60;
const HEADING_MAX_WORDS: usize = 8;
const HEADING_MIN_FOLLOWING_CHARS: usize = 40;
const HEADING_SENTENCE_MARGIN: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Block {
    Paragraph,
    Heading {
        level: u8,
        confidence: Confidence,
    },
    List {
        ordered: bool,
        items: Vec<String>,
        confidence: Confidence,
    },
    Table {
        table: Table,
        confidence: Confidence,
    },
    CreateTable(CreateTable),
}

fn unordered_item(line: &str) -> Option<&str> {
    ["- ", "* ", "• ", "– ", "— ", "+ "]
        .iter()
        .find_map(|marker| line.strip_prefix(marker))
}

fn ordered_item(line: &str) -> Option<&str> {
    let marker_end = line.find(['.', ')'])?;
    let (marker, rest) = line.split_at(marker_end);
    let numbered =
        !marker.is_empty() && marker.len() <= 3 && marker.bytes().all(|b| b.is_ascii_digit());
    let lettered = marker.len() == 1
        && marker.bytes().all(|b| b.is_ascii_lowercase())
        && rest.starts_with(')');
    if !(numbered || lettered) {
        return None;
    }
    rest[1..].strip_prefix(' ')
}

fn detect_list(lines: &[&str]) -> Option<Block> {
    let collect = |item: fn(&str) -> Option<&str>| -> Option<Vec<String>> {
        lines
            .iter()
            .map(|line| item(line.trim()).map(|rest| rest.trim().to_string()))
            .collect()
    };
    if let Some(items) = collect(unordered_item) {
        return Some(Block::List {
            ordered: false,
            items,
            confidence: Confidence::Certain,
        });
    }
    if let Some(items) = collect(ordered_item) {
        return Some(Block::List {
            ordered: true,
            items,
            confidence: Confidence::Certain,
        });
    }
    counted(lines).map(|items| Block::List {
        ordered: true,
        items,
        confidence: Confidence::Likely,
    })
}

/// Lines written "1 texte", "2 texte" without a dot: a list only when the
/// numbers follow each other, so "3 pommes" alone stays a sentence.
fn counted(lines: &[&str]) -> Option<Vec<String>> {
    let numbered: Vec<(u32, String)> = lines
        .iter()
        .map(|line| {
            let (number, rest) = line.trim().split_once(' ')?;
            let rest = rest.trim();
            let short = (1..=3).contains(&number.len());
            (short && !rest.is_empty())
                .then(|| Some((number.parse::<u32>().ok()?, rest.to_string())))
                .flatten()
        })
        .collect::<Option<_>>()?;
    let follows = numbered.windows(2).all(|pair| pair[1].0 == pair[0].0 + 1);
    (numbered.len() >= 2 && follows).then(|| numbered.into_iter().map(|(_, rest)| rest).collect())
}

fn looks_like_heading(line: &str, next: Option<&str>, context: Context) -> bool {
    let line = line.trim();
    let following = next.map(str::trim).unwrap_or("");
    let starts_upper = line.chars().next().is_some_and(char::is_uppercase);
    let ends_open = !line.ends_with(['.', ',', ';', ':', '!', '?', '…']);
    let short = line.chars().count() <= HEADING_MAX_CHARS
        && line.split_whitespace().count() <= HEADING_MAX_WORDS;
    let (line_len, following_len) = (line.chars().count(), following.chars().count());
    let following_is_sentence = following.ends_with(['.', '!', '?', '…', ':'])
        && following_len >= line_len + HEADING_SENTENCE_MARGIN;
    let following_is_long = following_len >= HEADING_MIN_FOLLOWING_CHARS.max(line_len * 2);
    let followed_by_prose = following_is_sentence || following_is_long;
    let is_value = infer_property(&[line], context) != PropertyType::Text;
    starts_upper && ends_open && short && followed_by_prose && !is_value
}

pub fn classify(text: &str, next: Option<&str>, context: Context) -> Block {
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    if let [line] = lines.as_slice()
        && let Some(command) = detect_create_table(line)
    {
        return Block::CreateTable(command);
    }
    if let [line] = lines.as_slice()
        && let Some(table) = detect_records(line, context)
    {
        return Block::Table {
            table,
            confidence: Confidence::Likely,
        };
    }
    match lines.as_slice() {
        [] => Block::Paragraph,
        [line] if looks_like_heading(line, next, context) => Block::Heading {
            level: 2,
            confidence: Confidence::Likely,
        },
        [_] => Block::Paragraph,
        _ => {
            if let Some((table, confidence)) = detect_table(text, context) {
                return Block::Table { table, confidence };
            }
            detect_list(&lines).unwrap_or(Block::Paragraph)
        }
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn reads_numbers_that_follow_each_other_as_a_numbered_list() {
        let block = classify(
            "1 on serait la\n2 pas la\n3 ici",
            None,
            crate::model::Context {
                today: crate::values::Day {
                    year: 2026,
                    month: 11,
                    day: 12,
                },
                lang: crate::lang::Lang::Fr,
            },
        );
        let Block::List { ordered, items, .. } = block else {
            unreachable!("{block:?}")
        };
        assert!(ordered);
        assert_eq!(items, vec!["on serait la", "pas la", "ici"]);
    }

    #[test]
    fn leaves_numbers_that_do_not_follow_each_other() {
        let context = crate::model::Context {
            today: crate::values::Day {
                year: 2026,
                month: 11,
                day: 12,
            },
            lang: crate::lang::Lang::Fr,
        };
        assert!(!matches!(
            classify("3 pommes\n12 poires", None, context),
            Block::List { .. }
        ));
        assert!(!matches!(
            classify("1 seule ligne", None, context),
            Block::List { .. }
        ));
    }
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
    const PROSE: &str = "Nous avons revu le budget de l’année avec toute l’équipe hier soir.";

    fn kind(block: &Block) -> &'static str {
        match block {
            Block::Paragraph => "paragraph",
            Block::Heading { .. } => "heading",
            Block::List { .. } => "list",
            Block::Table { .. } => "table",
            Block::CreateTable(_) => "create_table",
        }
    }

    #[test]
    fn proposes_a_heading_for_a_short_line_before_prose() {
        assert_eq!(
            classify("Budget 2027", Some(PROSE), CONTEXT),
            Block::Heading {
                level: 2,
                confidence: Confidence::Likely
            }
        );
        assert_eq!(
            kind(&classify(
                "Histoire de la france",
                Some("Commencons par parler de la france."),
                CONTEXT
            )),
            "heading"
        );
        assert_eq!(
            kind(&classify(
                "Histoire de la france",
                Some("La France."),
                CONTEXT
            )),
            "paragraph"
        );
        assert_eq!(kind(&classify("Budget 2027", None, CONTEXT)), "paragraph");
        assert_eq!(
            kind(&classify("Budget 2027.", Some(PROSE), CONTEXT)),
            "paragraph"
        );
        assert_eq!(
            kind(&classify("bonjour", Some(PROSE), CONTEXT)),
            "paragraph"
        );
        assert_eq!(
            kind(&classify("Bonjour", Some("Ça va ?"), CONTEXT)),
            "paragraph"
        );
        assert_eq!(
            kind(&classify("12/03/2026", Some(PROSE), CONTEXT)),
            "paragraph"
        );
        assert_eq!(kind(&classify(PROSE, Some(PROSE), CONTEXT)), "paragraph");
    }

    #[test]
    fn reads_pasted_lists() {
        assert_eq!(
            classify("• pain\n• lait", None, CONTEXT),
            Block::List {
                ordered: false,
                items: vec!["pain".into(), "lait".into()],
                confidence: Confidence::Certain
            }
        );
        assert_eq!(
            classify("1. ouvrir\n2) fermer", None, CONTEXT),
            Block::List {
                ordered: true,
                items: vec!["ouvrir".into(), "fermer".into()],
                confidence: Confidence::Certain
            }
        );
        assert_eq!(
            classify("a) un\nb) deux", None, CONTEXT),
            Block::List {
                ordered: true,
                items: vec!["un".into(), "deux".into()],
                confidence: Confidence::Certain
            }
        );
        assert_eq!(kind(&classify("- pain\nlait", None, CONTEXT)), "paragraph");
        assert_eq!(
            kind(&classify("1.5 litre\n2.5 litres", None, CONTEXT)),
            "paragraph"
        );
    }

    #[test]
    fn reads_records_on_a_single_line() {
        assert_eq!(
            kind(&classify("paul 10 lundi, fred 20 mercredi", None, CONTEXT)),
            "table"
        );
    }

    #[test]
    fn a_table_wins_over_a_list() {
        assert_eq!(
            kind(&classify("Nom\tPrix\nCafé\t2 €", None, CONTEXT)),
            "table"
        );
    }
}
