use std::sync::OnceLock;

use serde::Serialize;
use spellbook::Dictionary;

use crate::lang::{Lang, Language, detect};
use crate::typography::protected_ranges;

const MAX_SUGGESTIONS: usize = 5;
const MIN_TYPO_CHARS: usize = 4;

static DICTIONARIES: [OnceLock<Dictionary>; Lang::ALL.len()] = [OnceLock::new(), OnceLock::new()];

fn dictionary(lang: Lang) -> Option<&'static Dictionary> {
    DICTIONARIES.get(lang.index())?.get()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Misspelling {
    pub from: usize,
    pub to: usize,
    pub word: String,
    pub correction: Option<String>,
    pub lang: Lang,
}

pub fn load(lang: Lang, aff: &str, dic: &str) -> Result<bool, String> {
    let Some(slot) = DICTIONARIES.get(lang.index()) else {
        return Ok(false);
    };
    if slot.get().is_some() {
        return Ok(false);
    }
    let dictionary = Dictionary::new(aff, dic).map_err(|error| error.to_string())?;
    Ok(slot.set(dictionary).is_ok())
}

pub fn check(text: &str, fallback: Lang) -> Vec<Misspelling> {
    let detected = detect(text);
    let lang = detected.unwrap_or(fallback);
    let Some(main) = dictionary(lang) else {
        return Vec::new();
    };
    let found = misspellings(main, text, lang.data());
    if detected.is_some() {
        return found;
    }
    found
        .into_iter()
        .filter(|m| {
            !Lang::ALL
                .iter()
                .filter_map(|other| dictionary(*other))
                .any(|other| is_known(other, &m.word))
        })
        .collect()
}

struct Word {
    from: usize,
    to: usize,
    opens_sentence: bool,
}

fn words(text: &str, language: &Language) -> Vec<Word> {
    let keeps_apostrophes = language.elided.is_empty();
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let letter = |i: usize| chars.get(i).is_some_and(|(_, c)| c.is_alphabetic());
    let mut out = Vec::new();
    let mut i = 0;
    let mut opens_sentence = true;
    while i < chars.len() {
        if !letter(i) {
            let c = chars[i].1;
            if matches!(c, '.' | '!' | '?' | '…' | ':' | '\n') {
                opens_sentence = true;
            } else if c.is_alphanumeric() {
                opens_sentence = false;
            }
            i += 1;
            continue;
        }
        let start = i;
        let joins = |i: usize| {
            chars
                .get(i)
                .is_some_and(|(_, c)| *c == '-' || (keeps_apostrophes && matches!(c, '\'' | '’')))
                && letter(i + 1)
        };
        while letter(i) || joins(i) {
            i += 1;
        }
        let touches_digit = |j: Option<usize>| {
            j.and_then(|j| chars.get(j))
                .is_some_and(|(_, c)| c.is_ascii_digit())
        };
        let elided = chars.get(i).is_some_and(|(_, c)| matches!(c, '\'' | '’'));
        if !elided && !touches_digit(start.checked_sub(1)) && !touches_digit(Some(i)) {
            out.push(Word {
                from: chars[start].0,
                to: chars.get(i).map_or(text.len(), |(at, _)| *at),
                opens_sentence,
            });
        }
        opens_sentence = false;
    }
    out
}

fn is_known(dictionary: &Dictionary, word: &str) -> bool {
    let word = &word.replace('’', "'");
    dictionary.check(word)
        || (word.contains('-') && word.split('-').all(|part| dictionary.check(part)))
}

fn looks_like_a_name(word: &str, opens_sentence: bool) -> bool {
    let mut chars = word.chars();
    let first_upper = chars.next().is_some_and(char::is_uppercase);
    let other_upper = chars.any(char::is_uppercase);
    other_upper || (first_upper && !opens_sentence)
}

const MAX_ACCENT_VARIANTS: usize = 2048;

fn accent_variants(c: char) -> &'static [char] {
    match c {
        'a' => &['a', 'à', 'â'],
        'c' => &['c', 'ç'],
        'e' => &['e', 'é', 'è', 'ê', 'ë'],
        'i' => &['i', 'î', 'ï'],
        'o' => &['o', 'ô'],
        'u' => &['u', 'ù', 'û', 'ü'],
        _ => &[],
    }
}

fn with_accents(word: &[char]) -> Vec<String> {
    let mut out: Vec<Vec<char>> = vec![Vec::with_capacity(word.len())];
    for &c in word {
        let variants = accent_variants(c);
        if variants.is_empty() || out.len() * variants.len() > MAX_ACCENT_VARIANTS {
            out.iter_mut().for_each(|w| w.push(c));
            continue;
        }
        out = out
            .into_iter()
            .flat_map(|w| {
                variants.iter().map(move |&v| {
                    let mut next = w.clone();
                    next.push(v);
                    next
                })
            })
            .collect();
    }
    out.into_iter().map(|w| w.into_iter().collect()).collect()
}

fn one_edit(word: &[char], letters: &str) -> Vec<String> {
    let text = |chars: &[char]| chars.iter().collect::<String>();
    let mut out = Vec::new();
    for i in 0..word.len() {
        out.push(text(&[&word[..i], &word[i + 1..]].concat()));
        if i + 1 < word.len() {
            let mut swapped = word.to_vec();
            swapped.swap(i, i + 1);
            out.push(text(&swapped));
        }
        for c in letters.chars() {
            let mut replaced = word.to_vec();
            replaced[i] = c;
            out.push(text(&replaced));
        }
    }
    for i in 0..=word.len() {
        for c in letters.chars() {
            out.push(text(&[&word[..i], &[c], &word[i..]].concat()));
        }
    }
    out
}

fn split_in_two(dictionary: &Dictionary, word: &[char]) -> Vec<String> {
    (2..word.len().saturating_sub(1))
        .map(|i| {
            (
                word[..i].iter().collect::<String>(),
                word[i..].iter().collect::<String>(),
            )
        })
        .filter(|(left, right)| dictionary.check(left) && dictionary.check(right))
        .map(|(left, right)| format!("{left} {right}"))
        .collect()
}

fn unique_known(dictionary: &Dictionary, word: &str, candidates: Vec<String>) -> Vec<String> {
    let mut known: Vec<String> = candidates
        .into_iter()
        .filter(|c| c != word && dictionary.check(c))
        .collect();
    known.sort();
    known.dedup();
    known
}

fn with_case_of(model: &str, word: String) -> String {
    let mut chars = word.chars();
    match (model.chars().next(), chars.next()) {
        (Some(m), Some(first)) if m.is_uppercase() => first.to_uppercase().chain(chars).collect(),
        _ => word,
    }
}

fn sure_correction(dictionary: &Dictionary, word: &str, language: &Language) -> Option<String> {
    let lower: Vec<char> = word.to_lowercase().chars().collect();
    let lower_word: String = lower.iter().collect();
    let accented = if language.accents.is_empty() {
        Vec::new()
    } else {
        unique_known(dictionary, &lower_word, with_accents(&lower))
    };
    if let [only] = accented.as_slice() {
        return Some(with_case_of(word, only.clone()));
    }
    if !accented.is_empty() || lower.len() < MIN_TYPO_CHARS {
        return None;
    }
    let edits = unique_known(dictionary, &lower_word, one_edit(&lower, language.letters));
    let candidates = if edits.is_empty() {
        split_in_two(dictionary, &lower)
    } else {
        edits
    };
    match candidates.as_slice() {
        [only] => Some(with_case_of(word, only.clone())),
        _ => None,
    }
}

pub fn suggest(word: &str, lang: Lang) -> Vec<String> {
    let Some(dictionary) = dictionary(lang) else {
        return Vec::new();
    };
    let mut suggestions = Vec::new();
    dictionary.suggest(word, &mut suggestions);
    suggestions.truncate(MAX_SUGGESTIONS);
    suggestions
}

fn misspellings(dictionary: &Dictionary, text: &str, language: &Language) -> Vec<Misspelling> {
    let protected = protected_ranges(text);
    words(text, language)
        .into_iter()
        .filter(|w| {
            !protected
                .iter()
                .any(|(from, to)| w.from < *to && *from < w.to)
        })
        .filter_map(|w| {
            let word = &text[w.from..w.to];
            if is_known(dictionary, word) || looks_like_a_name(word, w.opens_sentence) {
                return None;
            }
            Some(Misspelling {
                from: utf16(text, w.from),
                to: utf16(text, w.to),
                word: word.to_string(),
                correction: sure_correction(dictionary, word, language),
                lang: language.lang,
            })
        })
        .collect()
}

fn utf16(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AFF: &str = "SET UTF-8\nTRY esianrtolcdugmphbyfvkwzéèêàçûîôœ\n";
    const DIC: &str = "9\nde\nsystème\nécriture\nétais\ntoujours\npas\nle\ntexte\nParis\n";

    fn small() -> Dictionary {
        Dictionary::new(AFF, DIC).unwrap_or_else(|error| unreachable!("{error}"))
    }

    fn found(text: &str) -> Vec<(String, Option<String>)> {
        misspellings(&small(), text, Lang::Fr.data())
            .into_iter()
            .map(|m| (m.word, m.correction))
            .collect()
    }

    #[test]
    fn corrects_a_missing_accent() {
        assert_eq!(
            found("le systeme"),
            vec![("systeme".into(), Some("système".into()))]
        );
        assert_eq!(
            found("j’etais"),
            vec![("etais".into(), Some("étais".into()))]
        );
    }

    #[test]
    fn corrects_a_single_close_typo() {
        assert_eq!(
            found("touhours"),
            vec![("touhours".into(), Some("toujours".into()))]
        );
    }

    #[test]
    fn leaves_short_or_ambiguous_words_to_the_writer() {
        let short = found("aps");
        assert_eq!(short.len(), 1);
        assert_eq!(short[0].1, None);
    }

    #[test]
    fn skips_names_links_and_numbers() {
        assert!(found("le texte de Dupont").is_empty());
        assert!(found("Paris").is_empty());
        assert!(found("le https://exemple.fr/systeme le 12km").is_empty());
        assert_eq!(found("texte-systeme").len(), 1);
    }

    #[test]
    fn reports_utf16_offsets() {
        let found = misspellings(&small(), "🎉 systeme", Lang::Fr.data());
        assert_eq!((found[0].from, found[0].to), (3, 10));
    }

    #[test]
    fn keeps_the_capital_of_the_typed_word() {
        assert_eq!(
            found("Systeme"),
            vec![("Systeme".into(), Some("Système".into()))]
        );
    }

    #[test]
    fn splits_two_glued_words() {
        assert_eq!(
            found("letexte"),
            vec![("letexte".into(), Some("le texte".into()))]
        );
    }
}
