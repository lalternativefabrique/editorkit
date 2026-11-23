use serde::Serialize;

use crate::lang::{Language, lang_of};
use crate::model::Context;
use crate::values::parse_date;

const LABEL_MAX_WORDS: usize = 4;
const LABEL_MAX_CHARS: usize = 30;
const DATE_MAX_WORDS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mark {
    Bold,
    Italic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    ForeignWord,
    CitedWord,
    Label,
    Deadline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Emphasis {
    pub from: usize,
    pub to: usize,
    pub mark: Mark,
    pub reason: Reason,
}

struct Word<'a> {
    from: usize,
    to: usize,
    lower: String,
    raw: &'a str,
}

fn words(text: &str) -> Vec<Word<'_>> {
    let mut out = Vec::new();
    let mut start = None;
    let is_word = |c: char| c.is_alphanumeric() || c == '-';
    for (at, c) in text.char_indices().chain([(text.len(), ' ')]) {
        match (start, is_word(c)) {
            (None, true) => start = Some(at),
            (Some(from), false) => {
                let raw = &text[from..at];
                out.push(Word {
                    from,
                    to: at,
                    lower: raw.to_lowercase(),
                    raw,
                });
                start = None;
            }
            _ => {}
        }
    }
    out
}

fn joined_by_spaces(text: &str, words: &[Word]) -> bool {
    words.windows(2).all(|pair| {
        text[pair[0].to..pair[1].from]
            .chars()
            .all(|c| c.is_whitespace() || matches!(c, '\'' | '’'))
            && pair[0].to < pair[1].from
    })
}

fn phrase_at(text: &str, words: &[Word], at: usize, phrase: &str) -> Option<usize> {
    let parts: Vec<&str> = phrase.split(' ').collect();
    let window = words.get(at..at + parts.len())?;
    let same = window.iter().zip(&parts).all(|(w, p)| w.lower == *p);
    (same && joined_by_spaces(text, window)).then_some(parts.len())
}

fn foreign_words(text: &str, words: &[Word], language: &Language) -> Vec<Emphasis> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let longest = language
            .foreign_locutions
            .iter()
            .filter_map(|phrase| phrase_at(text, words, i, phrase))
            .max();
        match longest {
            Some(len) => {
                out.push(span(
                    words[i].from,
                    words[i + len - 1].to,
                    Mark::Italic,
                    Reason::ForeignWord,
                ));
                i += len;
            }
            None => i += 1,
        }
    }
    out
}

fn cited_words(text: &str, words: &[Word], language: &Language) -> Vec<Emphasis> {
    words
        .windows(3)
        .filter(|w| {
            language.citing_determiners.contains(&w[0].lower.as_str())
                && language.citing_nouns.contains(&w[1].lower.as_str())
                && !language.not_cited.contains(&w[2].lower.as_str())
                && w[2].raw.chars().all(char::is_alphabetic)
                && text[w[1].to..w[2].from].chars().all(char::is_whitespace)
                && joined_by_spaces(text, &w[..2])
        })
        .map(|w| span(w[2].from, w[2].to, Mark::Italic, Reason::CitedWord))
        .collect()
}

fn label(text: &str) -> Option<Emphasis> {
    let colon = text.find(':')?;
    let name = text[..colon].trim_end();
    let rest = text[colon + 1..].trim();
    let starts_upper = name.chars().next().is_some_and(char::is_uppercase);
    let only_words = name
        .chars()
        .all(|c| c.is_alphabetic() || c.is_whitespace() || matches!(c, '\'' | '’' | '-'));
    let word_count = name.split_whitespace().count();
    let fits =
        (1..=LABEL_MAX_WORDS).contains(&word_count) && name.chars().count() <= LABEL_MAX_CHARS;
    (starts_upper && only_words && fits && !rest.is_empty())
        .then(|| span(0, colon + 1, Mark::Bold, Reason::Label))
}

fn deadlines(text: &str, words: &[Word], context: Context, language: &Language) -> Vec<Emphasis> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let trigger = language
            .deadline_triggers
            .iter()
            .find_map(|phrase| phrase_at(text, words, i, phrase));
        let date_end = trigger.and_then(|len| {
            let first = words.get(i + len)?;
            (1..=DATE_MAX_WORDS).rev().find_map(|count| {
                let last = words.get(i + len + count - 1)?;
                is_day(&text[first.from..last.to], context).then_some((len + count, last.to))
            })
        });
        match date_end {
            Some((consumed, to)) => {
                out.push(span(words[i].from, to, Mark::Bold, Reason::Deadline));
                i += consumed;
            }
            None => i += 1,
        }
    }
    out
}

fn is_day(text: &str, context: Context) -> bool {
    parse_date(text, context.today).is_some()
}

fn span(from: usize, to: usize, mark: Mark, reason: Reason) -> Emphasis {
    Emphasis {
        from,
        to,
        mark,
        reason,
    }
}

pub fn emphasize(text: &str, context: Context) -> Vec<Emphasis> {
    let language = lang_of(text, context.lang).data();
    let words = words(text);
    let mut found: Vec<Emphasis> = label(text).into_iter().collect();
    found.extend(deadlines(text, &words, context, language));
    found.extend(foreign_words(text, &words, language));
    found.extend(cited_words(text, &words, language));
    found.sort_by_key(|e| e.from);

    let mut kept: Vec<Emphasis> = Vec::new();
    for emphasis in found {
        if kept.last().is_none_or(|last| last.to <= emphasis.from) {
            kept.push(emphasis);
        }
    }
    kept.into_iter()
        .map(|e| Emphasis {
            from: utf16(text, e.from),
            to: utf16(text, e.to),
            ..e
        })
        .collect()
}

fn utf16(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
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

    fn marked(text: &str) -> Vec<(String, Mark, Reason)> {
        let units: Vec<u16> = text.encode_utf16().collect();
        emphasize(text, CONTEXT)
            .into_iter()
            .map(|e| {
                (
                    String::from_utf16_lossy(&units[e.from..e.to]),
                    e.mark,
                    e.reason,
                )
            })
            .collect()
    }

    fn one(text: &str, mark: Mark, reason: Reason, expected: &str) {
        assert_eq!(
            marked(text),
            vec![(expected.into(), mark, reason)],
            "{text:?}"
        );
    }

    #[test]
    fn italicises_latin_and_english_words() {
        one(
            "C’est a priori réglé.",
            Mark::Italic,
            Reason::ForeignWord,
            "a priori",
        );
        one(
            "Une condition sine qua non.",
            Mark::Italic,
            Reason::ForeignWord,
            "sine qua non",
        );
        one(
            "On fixe la deadline demain.",
            Mark::Italic,
            Reason::ForeignWord,
            "deadline",
        );
        one(
            "Il a dit [sic] hier.",
            Mark::Italic,
            Reason::ForeignWord,
            "sic",
        );
        assert!(marked("Une priorité, à priori.").is_empty());
        assert!(marked("Un apriori tenace.").is_empty());
    }

    #[test]
    fn italicises_a_word_quoted_as_a_word() {
        one(
            "Le mot chat a trois lettres.",
            Mark::Italic,
            Reason::CitedWord,
            "chat",
        );
        one(
            "Conjugue le verbe être.",
            Mark::Italic,
            Reason::CitedWord,
            "être",
        );
        assert!(marked("Le mot de passe expire.").is_empty());
        assert!(marked("Trouve le mot juste.").is_empty());
        assert!(marked("Le mot « chat » suffit.").is_empty());
    }

    #[test]
    fn bolds_a_leading_label() {
        one(
            "Attention : ne pas débrancher.",
            Mark::Bold,
            Reason::Label,
            "Attention :",
        );
        one(
            "À retenir\u{a0}: tout.",
            Mark::Bold,
            Reason::Label,
            "À retenir\u{a0}:",
        );
        assert!(marked("Rendez-vous à 16:30 demain").is_empty());
        assert!(marked("Attention :").is_empty());
        assert!(marked("voici : la liste").is_empty());
        assert!(marked("Il faut que tout le monde lise ceci : rien").is_empty());
    }

    #[test]
    fn bolds_a_deadline() {
        one(
            "Rends le rapport avant le 14 novembre, merci.",
            Mark::Bold,
            Reason::Deadline,
            "avant le 14 novembre",
        );
        one(
            "C’est à faire d’ici vendredi.",
            Mark::Bold,
            Reason::Deadline,
            "d’ici vendredi",
        );
        one(
            "Ouvert jusqu’au 12/03.",
            Mark::Bold,
            Reason::Deadline,
            "jusqu’au 12/03",
        );
        assert!(marked("Lis ceci avant le début.").is_empty());
        assert!(marked("Il était là avant.").is_empty());
    }

    #[test]
    fn uses_the_rules_of_the_sentence_language() {
        one(
            "Please send the report by Friday, thanks.",
            Mark::Bold,
            Reason::Deadline,
            "by Friday",
        );
        one(
            "The meeting is at noon and it is ad hoc.",
            Mark::Italic,
            Reason::ForeignWord,
            "ad hoc",
        );
        one(
            "The word cat has three letters.",
            Mark::Italic,
            Reason::CitedWord,
            "cat",
        );
    }

    #[test]
    fn combines_and_reports_utf16_offsets() {
        let text = "🎉 Note : on en parle de facto avant le 2 décembre.";
        assert_eq!(
            marked(text),
            vec![
                ("de facto".into(), Mark::Italic, Reason::ForeignWord),
                ("avant le 2 décembre".into(), Mark::Bold, Reason::Deadline),
            ]
        );
        assert_eq!(
            marked("Note : on en parle de facto."),
            vec![
                ("Note :".into(), Mark::Bold, Reason::Label),
                ("de facto".into(), Mark::Italic, Reason::ForeignWord),
            ]
        );
    }
}
