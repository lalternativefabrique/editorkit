use serde::{Deserialize, Serialize};

use crate::lang::{Lang, Language, PeriodEnd, Span};
use crate::values::{Day, day_number, fold_accents, month_named, weekday_named};

const MAX_HOUR: u32 = 24;
const MAX_MINUTE: u32 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MomentKind {
    Appointment,
    Reminder,
    Note,
    Mail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Moment {
    pub kind: MomentKind,
    pub kind_found: bool,
    #[serde(serialize_with = "iso")]
    pub day: Day,
    pub day_found: bool,
    pub hour: u32,
    pub minute: u32,
    pub has_time: bool,
    pub title: String,
}

fn iso<S: serde::Serializer>(day: &Day, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&day.to_string())
}

struct Token {
    from: usize,
    to: usize,
    word: String,
}

const ELISIONS: &[&str] = &["c", "d", "j", "l", "m", "n", "s", "t", "qu"];

fn tokens(line: &str) -> Vec<Token> {
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    let inner = |i: usize| {
        chars
            .get(i)
            .is_some_and(|(_, c)| matches!(c, '-' | '\'' | '’' | ':' | '/'))
            && chars.get(i + 1).is_some_and(|(_, c)| c.is_alphanumeric())
            && i > 0
            && chars.get(i - 1).is_some_and(|(_, c)| c.is_alphanumeric())
    };
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].1.is_alphanumeric() {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && (chars[i].1.is_alphanumeric() || inner(i)) {
            i += 1;
        }
        let from = chars[start].0;
        let to = chars.get(i).map_or(line.len(), |(at, _)| *at);
        let word = fold_accents(&line[from..to].to_lowercase()).replace('’', "'");
        match word.split_once('\'') {
            Some((head, _)) if ELISIONS.contains(&head) => {
                let cut = from + line[from..to].find(['\'', '’']).unwrap_or(0);
                let apostrophe = line[cut..].chars().next().map_or(1, char::len_utf8);
                out.push(Token {
                    from,
                    to: cut + apostrophe,
                    word: format!("{head}'"),
                });
                out.push(Token {
                    from: cut + apostrophe,
                    to,
                    word: word[head.len() + 1..].to_string(),
                });
            }
            _ => out.push(Token { from, to, word }),
        }
    }
    out
}

fn languages() -> impl Iterator<Item = &'static Language> {
    Lang::ALL.iter().map(|lang| lang.data())
}

fn phrase_at(tokens: &[Token], at: usize, phrase: &str) -> Option<usize> {
    let words: Vec<&str> = phrase.split(' ').collect();
    let window = tokens.get(at..at + words.len())?;
    window
        .iter()
        .zip(&words)
        .all(|(t, w)| t.word == *w)
        .then_some(words.len())
}

fn kind_at_start(tokens: &[Token]) -> Option<(MomentKind, usize)> {
    let matches: Vec<(MomentKind, usize, &[&str])> = languages()
        .flat_map(|language| language.moment_kinds.iter())
        .filter_map(|(phrase, kind, connectors)| {
            phrase_at(tokens, 0, phrase).map(|used| (*kind, used, *connectors))
        })
        .collect();
    let used = matches.iter().map(|(_, used, _)| *used).max()?;
    let longest: Vec<&(MomentKind, usize, &[&str])> =
        matches.iter().filter(|(_, n, _)| *n == used).collect();
    let kind = longest.first()?.0;
    let connector = tokens.get(used).is_some_and(|t| {
        longest
            .iter()
            .any(|(_, _, connectors)| connectors.contains(&t.word.as_str()))
    });
    Some((kind, used + usize::from(connector)))
}

fn clock(word: &str) -> Option<(&str, &str, &str)> {
    let digits = word
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(word.len());
    let (hour, rest) = word.split_at(digits);
    if hour.is_empty() || hour.len() > 2 {
        return None;
    }
    let (minutes, suffix) = match rest.strip_prefix(['h', ':']) {
        Some(after) => {
            let end = after
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(after.len());
            (&after[..end], &after[end..])
        }
        None => ("", rest),
    };
    let separated = rest.starts_with(['h', ':']);
    let meridiem = matches!(suffix, "am" | "pm");
    let minutes_ok = minutes.is_empty() || minutes.len() == 2;
    (minutes_ok && (separated || meridiem) && (suffix.is_empty() || meridiem))
        .then_some((hour, minutes, suffix))
}

struct Found {
    from: usize,
    to: usize,
}

fn find_time(tokens: &[Token]) -> Option<(Found, Option<(u32, u32)>)> {
    let with_prefix = |at: usize| {
        at.checked_sub(1)
            .filter(|before| {
                languages().any(|l| l.time_prefixes.contains(&tokens[*before].word.as_str()))
            })
            .unwrap_or(at)
    };
    for (at, token) in tokens.iter().enumerate() {
        let next = tokens.get(at + 1).map(|t| t.word.as_str());
        let spaced = match next {
            Some(suffix @ ("h" | "am" | "pm")) => Some((format!("{}{suffix}", token.word), 2)),
            _ => None,
        };
        let candidates = [Some((token.word.clone(), 1)), spaced];
        for (word, used) in candidates.into_iter().flatten() {
            let Some((hour, minutes, suffix)) = clock(&word) else {
                continue;
            };
            let mut hour: u32 = hour.parse().ok()?;
            let minute: u32 = if minutes.is_empty() {
                0
            } else {
                minutes.parse().ok()?
            };
            match suffix {
                "pm" if hour < 12 => hour += 12,
                "am" if hour == 12 => hour = 0,
                _ => {}
            }
            let found = Found {
                from: tokens[with_prefix(at)].from,
                to: tokens[at + used - 1].to,
            };
            let valid = hour < MAX_HOUR && minute < MAX_MINUTE;
            return Some((found, valid.then_some((hour, minute))));
        }
    }
    tokens.iter().enumerate().find_map(|(at, token)| {
        let hour = languages()
            .flat_map(|l| l.time_words.iter())
            .find(|(word, _)| *word == token.word)
            .map(|(_, hour)| u32::from(*hour))?;
        Some((
            Found {
                from: tokens[with_prefix(at)].from,
                to: token.to,
            },
            Some((hour, 0)),
        ))
    })
}

fn next_occurrence(today: Day, month: u8, day: u8) -> Option<Day> {
    let this_year = Day::new(today.year, month, day);
    match this_year {
        Some(date) if date >= today => Some(date),
        _ => Day::new(today.year + 1, month, day),
    }
}

fn day_prefix_start(tokens: &[Token], at: usize) -> usize {
    let mut start = at;
    while start > 0
        && languages().any(|l| l.day_prefixes.contains(&tokens[start - 1].word.as_str()))
        && at - start < 2
    {
        start -= 1;
    }
    start
}

fn number_at(tokens: &[Token], at: usize) -> Option<i64> {
    let word = tokens.get(at)?.word.as_str();
    if let Ok(n) = word.parse::<i64>() {
        return Some(n);
    }
    languages()
        .flat_map(|l| l.number_words.iter())
        .find(|(w, _)| *w == word)
        .and_then(|(_, n)| i64::try_from(*n).ok())
}

fn plus_months(day: Day, months: i64) -> Option<Day> {
    let index = i64::from(day.year) * 12 + i64::from(day.month) - 1 + months;
    let year = i32::try_from(index.div_euclid(12)).ok()?;
    let month = u8::try_from(index.rem_euclid(12) + 1).ok()?;
    (1..=day.day).rev().find_map(|d| Day::new(year, month, d))
}

fn ahead_at(tokens: &[Token], at: usize, today: Day) -> Option<(usize, Day)> {
    let word = tokens.get(at)?.word.as_str();
    if !languages().any(|l| l.ahead.contains(&word)) {
        return None;
    }
    let count = number_at(tokens, at + 1)?;
    let unit = tokens.get(at + 2)?.word.as_str();
    let span = languages()
        .flat_map(|l| l.spans.iter())
        .find(|(w, _)| *w == unit)
        .map(|(_, span)| *span)?;
    let day = match span {
        Span::Days => today.plus_days(count)?,
        Span::Weeks => today.plus_days(count * 7)?,
        Span::Months => plus_months(today, count)?,
    };
    Some((at + 2, day))
}

fn end_at(tokens: &[Token], at: usize, today: Day) -> Option<(usize, Day)> {
    languages()
        .flat_map(|l| l.period_ends.iter())
        .find_map(|(phrase, end)| {
            let used = phrase_at(tokens, at, phrase)?;
            let day = match end {
                PeriodEnd::Week => {
                    let weekday = i64::from(today.weekday_from_monday());
                    let friday = (4 - weekday).rem_euclid(7);
                    today.plus_days(if weekday > 4 { friday } else { 4 - weekday })?
                }
                PeriodEnd::Month => {
                    plus_months(Day::new(today.year, today.month, 1)?, 1)?.plus_days(-1)?
                }
            };
            Some((at + used - 1, day))
        })
}

fn weekday_at(tokens: &[Token], at: usize, today: Day) -> Option<(usize, Day)> {
    let target = i64::try_from(weekday_named(&tokens.get(at)?.word)?).ok()?;
    let ahead = (target - i64::from(today.weekday_from_monday())).rem_euclid(7);
    let ahead = if ahead == 0 { 7 } else { ahead };
    let later = languages()
        .flat_map(|l| l.week_later.iter())
        .find_map(|phrase| phrase_at(tokens, at + 1, phrase));
    if let Some(used) = later {
        return Some((at + used, today.plus_days(ahead + 7)?));
    }
    let next_word = tokens
        .get(at + 1)
        .is_some_and(|n| languages().any(|l| l.next == n.word));
    Some((if next_word { at + 1 } else { at }, today.plus_days(ahead)?))
}

fn relative_at(tokens: &[Token], at: usize, today: Day) -> Option<(usize, Day)> {
    let word = tokens.get(at)?.word.as_str();
    let offset = languages()
        .flat_map(|l| l.relative_days.iter())
        .find(|(w, _)| *w == word)
        .map(|(_, offset)| *offset)?;
    Some((at, today.plus_days(offset)?))
}

fn dated_at(tokens: &[Token], at: usize, today: Day) -> Option<(usize, Day)> {
    let t = tokens.get(at)?;
    if let Some((d, m)) = t.word.split_once('/') {
        return Some((
            at,
            next_occurrence(today, m.parse().ok()?, d.parse().ok()?)?,
        ));
    }
    let next = tokens.get(at + 1)?;
    let (day, month) = match (day_number(&t.word), month_named(&next.word)) {
        (Some(day), Some(month)) => (day, month),
        _ => (day_number(&next.word)?, month_named(&t.word)?),
    };
    Some((at + 1, next_occurrence(today, month, day)?))
}

/// A day named by the words starting at token at: the last token it uses and the day.
fn day_at(tokens: &[Token], at: usize, today: Day) -> Option<(usize, Day)> {
    relative_at(tokens, at, today)
        .or_else(|| ahead_at(tokens, at, today))
        .or_else(|| end_at(tokens, at, today))
        .or_else(|| weekday_at(tokens, at, today))
        .or_else(|| dated_at(tokens, at, today))
        .or_else(|| {
            let starts_next = tokens.get(at).is_some_and(|t| {
                languages().any(|l| l.next == t.word && l.day_prefixes.contains(&l.next))
            });
            if !starts_next {
                return None;
            }
            weekday_at(tokens, at + 1, today)
        })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecognizedDay {
    /// UTF-16 offsets in the text, as an editor counts them.
    pub from: usize,
    pub to: usize,
    #[serde(serialize_with = "iso")]
    pub day: Day,
}

fn utf16_at(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

/// Every day the text names, in order, for an editor to offer as a date.
pub fn recognize_days(text: &str, today: Day) -> Vec<RecognizedDay> {
    let tokens = tokens(text);
    let mut out = Vec::new();
    let mut at = 0;
    while at < tokens.len() {
        match day_at(&tokens, at, today) {
            Some((end, day)) => {
                out.push(RecognizedDay {
                    from: utf16_at(text, tokens[at].from),
                    to: utf16_at(text, tokens[end].to),
                    day,
                });
                at = end + 1;
            }
            None => at += 1,
        }
    }
    out
}

fn find_day(tokens: &[Token], today: Day) -> Option<(Found, Day)> {
    let span = |from: usize, to: usize| Found {
        from: tokens[from].from,
        to: tokens[to].to,
    };
    let relative = tokens.iter().enumerate().find_map(|(at, t)| {
        let offset = languages()
            .flat_map(|l| l.relative_days.iter())
            .find(|(word, offset)| *word == t.word && *offset >= 0)
            .map(|(_, offset)| *offset)?;
        Some((span(at, at), today.plus_days(offset)?))
    });
    if relative.is_some() {
        return relative;
    }
    let period = (0..tokens.len()).find_map(|at| {
        let (end, day) = ahead_at(tokens, at, today).or_else(|| end_at(tokens, at, today))?;
        Some((span(at, end), day))
    });
    if period.is_some() {
        return period;
    }
    let weekday = (0..tokens.len()).find_map(|at| {
        let (end, day) = weekday_at(tokens, at, today)?;
        Some((span(day_prefix_start(tokens, at), end), day))
    });
    if weekday.is_some() {
        return weekday;
    }
    let dated = tokens.iter().enumerate().find_map(|(at, t)| {
        if let Some((d, m)) = t.word.split_once('/') {
            let date = next_occurrence(today, m.parse().ok()?, d.parse().ok()?)?;
            return Some((span(day_prefix_start(tokens, at), at), date));
        }
        let next = tokens.get(at + 1)?;
        let (day, month) = match (day_number(&t.word), month_named(&next.word)) {
            (Some(day), Some(month)) => (day, month),
            _ => (day_number(&next.word)?, month_named(&t.word)?),
        };
        Some((
            span(day_prefix_start(tokens, at), at + 1),
            next_occurrence(today, month, day)?,
        ))
    });
    if dated.is_some() {
        return dated;
    }
    tokens.iter().enumerate().find_map(|(at, t)| {
        let prefixed =
            at > 0 && languages().any(|l| l.day_prefixes.contains(&tokens[at - 1].word.as_str()));
        if !prefixed {
            return None;
        }
        let day = day_number(&t.word).filter(|d| (1..=31).contains(d))?;
        let (year, month) = if day < today.day {
            if today.month == 12 {
                (today.year + 1, 1)
            } else {
                (today.year, today.month + 1)
            }
        } else {
            (today.year, today.month)
        };
        Some((
            span(day_prefix_start(tokens, at), at),
            Day::new(year, month, day)?,
        ))
    })
}

fn title(line: &str, removed: &[Found]) -> String {
    let mut kept = String::new();
    let mut cursor = 0;
    let mut spans: Vec<&Found> = removed.iter().collect();
    spans.sort_by_key(|f| f.from);
    for span in spans {
        if span.from >= cursor {
            kept.push_str(&line[cursor..span.from]);
            kept.push(' ');
            cursor = span.to;
        }
    }
    kept.push_str(&line[cursor.min(line.len())..]);
    let collapsed = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut text = collapsed
        .trim_matches([' ', ',', '.', ';', '-'])
        .trim()
        .to_string();
    let lower = fold_accents(&text.to_lowercase());
    let filler = languages()
        .flat_map(|l| l.title_fillers.iter())
        .find(|f| lower.starts_with(&format!("{f} ")))
        .map(|f| f.len() + 1)
        .or_else(|| {
            ["d'", "d’"]
                .iter()
                .find(|p| text.to_lowercase().starts_with(*p))
                .map(|p| p.len())
        });
    if let Some(len) = filler {
        let cut = text
            .char_indices()
            .nth(lower[..len].chars().count())
            .map_or(text.len(), |(at, _)| at);
        text = text[cut..].trim().to_string();
    }
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

pub fn understand(line: &str, today: Day) -> Moment {
    let mut tokens = tokens(line);
    let mut removed: Vec<Found> = Vec::new();
    let (kind, kind_found) = match kind_at_start(&tokens) {
        Some((kind, used)) => {
            if let Some(last) = tokens.get(used.saturating_sub(1)) {
                removed.push(Found {
                    from: 0,
                    to: last.to,
                });
            }
            tokens.drain(..used.min(tokens.len()));
            (kind, true)
        }
        None => (MomentKind::Appointment, false),
    };
    let (mut hour, mut minute, mut has_time) = (0, 0, false);
    if let Some((found, Some((h, m)))) = find_time(&tokens) {
        (hour, minute, has_time) = (h, m, true);
        tokens.retain(|t| t.to <= found.from || t.from >= found.to);
        removed.push(found);
    }
    let (day, day_found) = match find_day(&tokens, today) {
        Some((found, day)) => {
            removed.push(found);
            (day, true)
        }
        None => (today, false),
    };
    Moment {
        kind,
        kind_found,
        day,
        day_found,
        hour,
        minute,
        has_time,
        title: title(line, &removed),
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn recognizes_every_day_a_sentence_names() {
        let today = Day {
            year: 2026,
            month: 11,
            day: 12,
        };
        let text = "Envoyer le devis jeudi prochain, relancer dans 2 semaines, bilan fin du mois et point lundi en huit 🎉 ou le 3 décembre.";
        let found: Vec<(String, String)> = recognize_days(text, today)
            .into_iter()
            .map(|r| {
                let units: Vec<u16> = text.encode_utf16().collect();
                (
                    String::from_utf16_lossy(&units[r.from..r.to]),
                    r.day.to_string(),
                )
            })
            .collect();
        assert_eq!(
            found,
            vec![
                ("jeudi prochain".into(), "2026-11-19".into()),
                ("dans 2 semaines".into(), "2026-11-26".into()),
                ("fin du mois".into(), "2026-11-30".into()),
                ("lundi en huit".into(), "2026-11-23".into()),
                ("3 décembre".into(), "2026-12-03".into()),
            ]
        );
    }

    #[test]
    fn recognizes_english_and_months_ahead() {
        let today = Day {
            year: 2026,
            month: 1,
            day: 31,
        };
        let days: Vec<String> = recognize_days(
            "next monday, in one month, end of the week, tomorrow",
            today,
        )
        .into_iter()
        .map(|r| r.day.to_string())
        .collect();
        assert_eq!(
            days,
            vec!["2026-02-02", "2026-02-28", "2026-02-06", "2026-02-01"]
        );
    }

    #[test]
    fn understands_the_new_periods() {
        let today = Day {
            year: 2026,
            month: 11,
            day: 12,
        };
        assert_eq!(
            understand("rappel dans 3 jours", today).day.to_string(),
            "2026-11-15"
        );
        assert_eq!(
            understand("rdv lundi en huit 10h", today).day.to_string(),
            "2026-11-23"
        );
    }
    use super::*;

    const WEDNESDAY: Day = Day {
        year: 2026,
        month: 10,
        day: 21,
    };

    fn day(month: u8, d: u8) -> Day {
        Day::new(2026, month, d).unwrap_or_else(|| unreachable!("day"))
    }

    fn check(line: &str, kind: MomentKind, on: Day, time: Option<(u32, u32)>, title_text: &str) {
        let moment = understand(line, WEDNESDAY);
        assert_eq!(
            (
                moment.kind,
                moment.day,
                moment.has_time,
                moment.title.as_str()
            ),
            (kind, on, time.is_some(), title_text),
            "{line:?}: {moment:?}"
        );
        if let Some((h, m)) = time {
            assert_eq!((moment.hour, moment.minute), (h, m), "{line:?}");
        }
    }

    #[test]
    fn matches_the_go_reader_line_for_line() {
        use MomentKind::*;
        check(
            "Dentiste jeudi 16h",
            Appointment,
            day(10, 22),
            Some((16, 0)),
            "Dentiste",
        );
        check(
            "rappel loyer demain 9h30",
            Reminder,
            day(10, 22),
            Some((9, 30)),
            "Loyer",
        );
        check(
            "Rappelle-moi d'appeler Marc",
            Reminder,
            day(10, 21),
            None,
            "Appeler Marc",
        );
        check(
            "Déjeuner Léa à midi",
            Appointment,
            day(10, 21),
            Some((12, 0)),
            "Déjeuner Léa",
        );
        check(
            "note sur la réunion équipe",
            Note,
            day(10, 21),
            None,
            "Réunion équipe",
        );
        check(
            "mail à Marc après-demain 8:15",
            Mail,
            day(10, 23),
            Some((8, 15)),
            "Marc",
        );
        check("Banque le 7", Appointment, day(11, 7), None, "Banque");
        check(
            "Anniversaire Léa 31 octobre",
            Appointment,
            day(10, 31),
            None,
            "Anniversaire Léa",
        );
        check(
            "Impôts 15/05",
            Appointment,
            Day::new(2027, 5, 15).unwrap_or_else(|| unreachable!("day")),
            None,
            "Impôts",
        );
        check("Équipe mercredi", Appointment, day(10, 28), None, "Équipe");
    }

    #[test]
    fn keeps_an_impossible_hour_in_the_title() {
        let moment = understand("Salle 31h", WEDNESDAY);
        assert!(!moment.has_time);
        assert_eq!(moment.title, "Salle 31h");
    }

    #[test]
    fn reads_english_lines_too() {
        use MomentKind::*;
        check(
            "Dentist on Thursday at 4pm",
            Appointment,
            day(10, 22),
            Some((16, 0)),
            "Dentist",
        );
        check(
            "remind me to call Mark tomorrow 9:30am",
            Reminder,
            day(10, 22),
            Some((9, 30)),
            "Call Mark",
        );
        check(
            "email Bob next Friday at noon",
            Mail,
            day(10, 23),
            Some((12, 0)),
            "Bob",
        );
        check(
            "Lunch with Lea October 31",
            Appointment,
            day(10, 31),
            None,
            "Lunch with Lea",
        );
        check("Bank on the 7th", Appointment, day(11, 7), None, "Bank");
    }

    #[test]
    fn reads_french_lines_the_go_reader_missed() {
        use MomentKind::*;
        check(
            "Dentiste le jeudi 16 h",
            Appointment,
            day(10, 22),
            Some((16, 0)),
            "Dentiste",
        );
        check(
            "rdv avec Paul lundi prochain 10h",
            Appointment,
            day(10, 26),
            Some((10, 0)),
            "Paul",
        );
        check(
            "n'oublie pas de payer le loyer",
            Reminder,
            day(10, 21),
            None,
            "Payer le loyer",
        );
    }
}
