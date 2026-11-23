use serde::Serialize;

use crate::lang::{Lang, Typography};

const NBSP: &str = "\u{a0}";
const NNBSP: &str = "\u{202f}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Edit {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

struct Chars {
    items: Vec<(usize, char)>,
    text_len: usize,
}

impl Chars {
    fn new(text: &str) -> Chars {
        Chars {
            items: text.char_indices().collect(),
            text_len: text.len(),
        }
    }

    fn at(&self, i: usize) -> Option<char> {
        self.items.get(i).map(|(_, c)| *c)
    }

    fn before(&self, i: usize) -> Option<char> {
        i.checked_sub(1).and_then(|j| self.at(j))
    }

    fn byte(&self, i: usize) -> usize {
        self.items
            .get(i)
            .map(|(at, _)| *at)
            .unwrap_or(self.text_len)
    }
}

pub(crate) fn protected_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    for token in text.split_inclusive(char::is_whitespace) {
        let word = token.trim_end();
        if word.contains("://")
            || word.starts_with("www.")
            || (word.contains('@') && word.contains('.'))
            || word.contains('`')
        {
            ranges.push((offset, offset + word.len()));
        }
        offset += token.len();
    }
    ranges
}

fn ends_word(c: Option<char>) -> bool {
    c.is_some_and(|c| c.is_alphanumeric() || matches!(c, '»' | ')' | ']' | '%' | '€'))
}

fn ends_clause(c: Option<char>) -> bool {
    c.is_none_or(|c| c.is_whitespace() || matches!(c, '!' | '?' | ')' | '»'))
}

fn word_before(chars: &Chars, i: usize) -> String {
    let mut start = i;
    while start > 0 && chars.at(start - 1).is_some_and(char::is_alphabetic) {
        start -= 1;
    }
    chars.items[start..i]
        .iter()
        .flat_map(|(_, c)| c.to_lowercase())
        .collect()
}

fn is_mistyped_apostrophe(chars: &Chars, i: usize, elided: &[&str]) -> bool {
    chars.at(i + 1).is_some_and(char::is_alphabetic)
        && elided.contains(&word_before(chars, i).as_str())
}

fn starts_sentence(chars: &Chars, i: usize) -> bool {
    let mut j = i;
    while j > 0 && chars.at(j - 1).is_some_and(char::is_whitespace) {
        j -= 1;
    }
    j == 0
        || chars
            .at(j - 1)
            .is_some_and(|c| matches!(c, '.' | '!' | '?' | '…'))
}

fn quote_pairs_balance(chars: &Chars, elided: &[&str]) -> bool {
    (0..chars.items.len())
        .filter(|&i| chars.at(i) == Some('"') && !is_mistyped_apostrophe(chars, i, elided))
        .count()
        % 2
        == 0
}

pub fn normalize(text: &str, lang: Lang) -> Vec<Edit> {
    let language = lang.data();
    let french = language.typography == Typography::French;
    let elided = language.elided;
    let chars = Chars::new(text);
    let protected = protected_ranges(text);
    let is_protected = |byte: usize| {
        protected
            .iter()
            .any(|(from, to)| (*from..*to).contains(&byte))
    };
    let balanced_quotes = quote_pairs_balance(&chars, elided);

    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let push = |from: usize, to: usize, insert: String, edits: &mut Vec<(usize, usize, String)>| {
        let clear = edits.last().is_none_or(|(_, end, _)| *end <= from);
        if clear && !is_protected(from) {
            edits.push((from, to, insert));
        }
    };

    let mut quote_open = false;
    let mut i = 0;
    while i < chars.items.len() {
        let c = chars.items[i].1;
        let here = chars.byte(i);
        match c {
            '.' if chars.at(i + 1) == Some('.') && chars.at(i + 2) == Some('.') => {
                push(here, chars.byte(i + 3), "…".into(), &mut edits);
                i += 3;
                continue;
            }
            '\'' if chars.before(i).is_some_and(char::is_alphabetic)
                && chars.at(i + 1).is_some_and(char::is_alphabetic) =>
            {
                push(here, chars.byte(i + 1), "’".into(), &mut edits);
            }
            '"' if is_mistyped_apostrophe(&chars, i, elided) => {
                push(here, chars.byte(i + 1), "’".into(), &mut edits);
            }
            'A' if french
                && !chars.before(i).is_some_and(char::is_alphanumeric)
                && chars.at(i + 1).is_some_and(char::is_whitespace)
                && starts_sentence(&chars, i) =>
            {
                push(here, chars.byte(i + 1), "À".into(), &mut edits);
            }
            '"' if balanced_quotes && !french => {
                let opens = !quote_open;
                push(
                    here,
                    chars.byte(i + 1),
                    (if opens { "“" } else { "”" }).into(),
                    &mut edits,
                );
                quote_open = opens;
            }
            '"' if balanced_quotes => {
                if quote_open {
                    let from = if chars.before(i) == Some(' ') {
                        chars.byte(i - 1)
                    } else {
                        here
                    };
                    push(from, chars.byte(i + 1), format!("{NBSP}»"), &mut edits);
                } else {
                    let to = if chars.at(i + 1) == Some(' ') {
                        chars.byte(i + 2)
                    } else {
                        chars.byte(i + 1)
                    };
                    push(here, to, format!("«{NBSP}"), &mut edits);
                    if chars.at(i + 1) == Some(' ') {
                        i += 1;
                    }
                }
                quote_open = !quote_open;
            }
            '«' if french && chars.at(i + 1) == Some(' ') => push(
                chars.byte(i + 1),
                chars.byte(i + 2),
                NBSP.into(),
                &mut edits,
            ),
            '»' if french && chars.before(i) == Some(' ') => {
                push(chars.byte(i - 1), here, NBSP.into(), &mut edits)
            }
            ';' | '!' | '?' | ':' if french => {
                let space = if c == ':' { NBSP } else { NNBSP };
                if chars.before(i) == Some(' ') && ends_clause(chars.at(i + 1)) {
                    push(chars.byte(i - 1), here, space.into(), &mut edits);
                } else if ends_word(chars.before(i)) && ends_clause(chars.at(i + 1)) {
                    push(here, here, space.into(), &mut edits);
                }
            }
            _ => {}
        }
        i += 1;
    }

    edits
        .into_iter()
        .map(|(from, to, insert)| Edit {
            from: utf16_offset(text, from),
            to: utf16_offset(text, to),
            insert,
        })
        .collect()
}

fn utf16_offset(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

pub fn apply(text: &str, edits: &[Edit]) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut out: Vec<u16> = Vec::with_capacity(units.len());
    let mut cursor = 0;
    for edit in edits {
        out.extend_from_slice(&units[cursor..edit.from]);
        out.extend(edit.insert.encode_utf16());
        cursor = edit.to;
    }
    out.extend_from_slice(&units[cursor..]);
    String::from_utf16_lossy(&out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fix(text: &str) -> String {
        apply(text, &normalize(text, Lang::Fr))
    }

    #[test]
    fn applies_french_spacing() {
        assert_eq!(fix("Bonjour !"), "Bonjour\u{202f}!");
        assert_eq!(fix("Vraiment?"), "Vraiment\u{202f}?");
        assert_eq!(fix("Note : important"), "Note\u{a0}: important");
        assert_eq!(fix("Note: important"), "Note\u{a0}: important");
        assert_eq!(fix("Quoi ?!"), "Quoi\u{202f}?!");
        assert_eq!(fix("un; deux"), "un\u{202f}; deux");
    }

    #[test]
    fn turns_quotes_apostrophes_and_ellipsis() {
        assert_eq!(
            fix("Il a dit \"oui\" hier"),
            "Il a dit «\u{a0}oui\u{a0}» hier"
        );
        assert_eq!(
            fix("Il a dit \" oui \" hier"),
            "Il a dit «\u{a0}oui\u{a0}» hier"
        );
        assert_eq!(fix("« oui »"), "«\u{a0}oui\u{a0}»");
        assert_eq!(fix("l'été"), "l’été");
        assert_eq!(fix("Attends..."), "Attends…");
        assert_eq!(fix("un \"seul"), "un \"seul");
        assert_eq!(fix("d\"ecriture et l\"été"), "d’ecriture et l’été");
        assert_eq!(
            fix("Il a dit \"oui\" à l\"instant"),
            "Il a dit «\u{a0}oui\u{a0}» à l’instant"
        );
    }

    #[test]
    fn accents_a_capital_a_that_opens_a_sentence() {
        assert_eq!(fix("A retenir"), "À retenir");
        assert_eq!(fix("Fini. A demain"), "Fini. À demain");
        assert_eq!(fix("le plan A est prêt"), "le plan A est prêt");
        assert_eq!(fix("Avec A"), "Avec A");
        assert_eq!(fix("A4 ou A"), "A4 ou A");
    }

    #[test]
    fn leaves_times_links_and_code_alone() {
        for text in [
            "Rendez-vous à 16:30",
            "Voir https://example.com/a?b=1 demain",
            "Écris à paul@example.com",
            "Lance `a:b` pour voir",
            "www.example.com:8080",
        ] {
            assert_eq!(fix(text), text, "{text:?}");
        }
    }

    #[test]
    fn follows_english_conventions_in_english() {
        let english = |text: &str| apply(text, &normalize(text, Lang::En));
        assert_eq!(
            english("He said \"yes\": it's done... Really?"),
            "He said “yes”: it’s done… Really?"
        );
        assert_eq!(english("A cat"), "A cat");
        assert_eq!(english("the d\"ecriture"), "the d\"ecriture");
    }

    #[test]
    fn is_idempotent() {
        for text in ["Bonjour ! Il a dit \"oui\" : l'été...", "« Salut » ; ok?"] {
            let once = fix(text);
            assert!(normalize(&once, Lang::Fr).is_empty(), "{once:?}");
        }
    }

    #[test]
    fn reports_offsets_in_utf16_units() {
        let edits = normalize("🎉 Super!", Lang::Fr);
        assert_eq!(
            edits,
            vec![Edit {
                from: 8,
                to: 8,
                insert: "\u{202f}".into()
            }]
        );
    }
}
