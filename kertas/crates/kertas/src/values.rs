use std::cmp::Ordering;
use std::fmt;

use crate::lang::Lang;
use serde::{Deserialize, Serialize};

const NBSP: char = '\u{a0}';
const NNBSP: char = '\u{202f}';
const GROUP_CHARS: [char; 6] = [' ', NBSP, NNBSP, '\'', ',', '.'];
const MAX_FRACTION_DIGITS: usize = 12;
const MAX_INTEGER_DIGITS: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    Eur,
    Usd,
    Gbp,
    Chf,
}

impl Currency {
    pub const ALL: [Currency; 4] = [Currency::Eur, Currency::Usd, Currency::Gbp, Currency::Chf];

    fn markers(self) -> &'static [&'static str] {
        match self {
            Currency::Eur => &["€", "EUR"],
            Currency::Usd => &["US$", "$", "USD"],
            Currency::Gbp => &["£", "GBP"],
            Currency::Chf => &["CHF"],
        }
    }

    fn symbol(self) -> &'static str {
        match self {
            Currency::Eur => "€",
            Currency::Usd => "$",
            Currency::Gbp => "£",
            Currency::Chf => "CHF",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decimal {
    pub units: i64,
    pub scale: u8,
}

impl Decimal {
    fn scaled_to(self, scale: u8) -> Option<i128> {
        let factor = 10i128.checked_pow(u32::from(scale.checked_sub(self.scale)?))?;
        i128::from(self.units).checked_mul(factor)
    }

    pub fn checked_add(self, other: Decimal) -> Option<Decimal> {
        let scale = self.scale.max(other.scale);
        let sum = self
            .scaled_to(scale)?
            .checked_add(other.scaled_to(scale)?)?;
        Some(Decimal {
            units: i64::try_from(sum).ok()?,
            scale,
        })
    }

    pub fn compare(self, other: Decimal) -> Ordering {
        let scale = self.scale.max(other.scale);
        match (self.scaled_to(scale), other.scaled_to(scale)) {
            (Some(a), Some(b)) => a.cmp(&b),
            _ => self.units.cmp(&other.units),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Day {
    pub year: i32,
    pub month: u8,
    pub day: u8,
}

impl Day {
    pub fn new(year: i32, month: u8, day: u8) -> Option<Day> {
        (1..=12).contains(&month).then_some(())?;
        (day >= 1 && day <= days_in_month(year, month)).then_some(Day { year, month, day })
    }

    pub(crate) fn days_since_epoch(self) -> i64 {
        let year = i64::from(self.year) - i64::from(self.month <= 2);
        let era = year.div_euclid(400);
        let year_of_era = year - era * 400;
        let month = i64::from(self.month);
        let day_of_year =
            (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(self.day) - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        era * 146_097 + day_of_era - 719_468
    }

    fn from_days_since_epoch(days: i64) -> Option<Day> {
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let day_of_era = z - era * 146_097;
        let year_of_era =
            (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let shifted_month = (5 * day_of_year + 2) / 153;
        let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
        let month = if shifted_month < 10 {
            shifted_month + 3
        } else {
            shifted_month - 9
        };
        let year = year_of_era + era * 400 + i64::from(month <= 2);
        Day::new(
            i32::try_from(year).ok()?,
            u8::try_from(month).ok()?,
            u8::try_from(day).ok()?,
        )
    }

    pub fn plus_days(self, days: i64) -> Option<Day> {
        Day::from_days_since_epoch(self.days_since_epoch() + days)
    }

    pub fn weekday_from_monday(self) -> u8 {
        u8::try_from((self.days_since_epoch() + 3).rem_euclid(7)).unwrap_or(0)
    }

    pub fn parse_iso(text: &str) -> Option<Day> {
        let mut parts = text.trim().splitn(3, '-');
        let year = parts.next().filter(|p| p.len() == 4)?.parse().ok()?;
        let month = parts.next().filter(|p| p.len() == 2)?.parse().ok()?;
        let day = parts.next().filter(|p| p.len() == 2)?.parse().ok()?;
        Day::new(year, month, day)
    }
}

impl fmt::Display for Day {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

impl TryFrom<String> for Day {
    type Error = String;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        Day::parse_iso(&text).ok_or_else(|| format!("not an ISO date: {text}"))
    }
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        2 if is_leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn split_sign(text: &str) -> (bool, &str) {
    for (marker, negative) in [("-", true), ("\u{2212}", true), ("+", false)] {
        if let Some(rest) = text.strip_prefix(marker) {
            return (negative, rest.trim_start());
        }
    }
    (false, text)
}

fn every_dot_groups_thousands(body: &str) -> bool {
    body.split('.')
        .skip(1)
        .all(|group| group.len() == 3 && group.bytes().all(|b| b.is_ascii_digit()))
}

fn decimal_separator(body: &str) -> Option<usize> {
    match (body.rfind(','), body.rfind('.')) {
        (Some(comma), Some(dot)) => Some(comma.max(dot)),
        (Some(comma), None) => (body.matches(',').count() == 1).then_some(comma),
        (None, Some(dot)) => (!every_dot_groups_thousands(body)).then_some(dot),
        (None, None) => None,
    }
}

fn ungrouped_digits(integer: &str) -> Option<String> {
    let Some(separator) = integer.chars().find(|c| !c.is_ascii_digit()) else {
        return (!integer.is_empty()).then(|| integer.to_string());
    };
    if !GROUP_CHARS.contains(&separator) {
        return None;
    }
    let groups: Vec<&str> = integer.split(separator).collect();
    let all_digits = |g: &str| !g.is_empty() && g.bytes().all(|b| b.is_ascii_digit());
    let first_ok = groups
        .first()
        .is_some_and(|g| all_digits(g) && g.len() <= 3);
    let rest_ok = groups.iter().skip(1).all(|g| all_digits(g) && g.len() == 3);
    (first_ok && rest_ok).then(|| groups.concat())
}

pub fn parse_decimal(text: &str) -> Option<Decimal> {
    let (negative, body) = split_sign(text.trim());
    let (integer, fraction) = match decimal_separator(body) {
        Some(at) => (&body[..at], &body[at + 1..]),
        None => (body, ""),
    };
    let digits = ungrouped_digits(integer)?;
    let has_separator = integer.len() < body.len();
    if has_separator && (fraction.is_empty() || !fraction.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    if digits.len() > MAX_INTEGER_DIGITS || fraction.len() > MAX_FRACTION_DIGITS {
        return None;
    }
    let scale = u8::try_from(fraction.len()).ok()?;
    let units: i64 = format!("{digits}{fraction}").parse().ok()?;
    Some(Decimal {
        units: if negative { -units } else { units },
        scale,
    })
}

fn strip_currency(upper: &str) -> Option<(Currency, &str)> {
    for currency in Currency::ALL {
        for marker in currency.markers() {
            if let Some(rest) = upper
                .strip_suffix(marker)
                .or_else(|| upper.strip_prefix(marker))
            {
                return Some((currency, rest));
            }
        }
    }
    None
}

fn minor_units(amount: Decimal) -> Option<i64> {
    let factor = 10i64.checked_pow(u32::from(2u8.checked_sub(amount.scale)?))?;
    amount.units.checked_mul(factor)
}

pub fn parse_money(text: &str, fallback: Option<Currency>) -> Option<(i64, Currency, bool)> {
    let upper = text.trim().to_uppercase();
    let (currency, amount, explicit) = match strip_currency(&upper) {
        Some((currency, rest)) => (
            currency,
            rest.trim_matches(|c: char| c.is_whitespace()),
            true,
        ),
        None => (fallback?, upper.as_str(), false),
    };
    let (negative, amount) = split_sign(amount);
    let minor = minor_units(parse_decimal(amount)?)?;
    Some((if negative { -minor } else { minor }, currency, explicit))
}

pub fn parse_percent(text: &str) -> Option<Decimal> {
    parse_decimal(
        text.trim()
            .strip_suffix('%')?
            .trim_end_matches(|c: char| c.is_whitespace()),
    )
}

pub fn parse_checkbox(text: &str) -> Option<bool> {
    match text.trim().to_lowercase().as_str() {
        "oui" | "yes" | "vrai" | "true" | "x" | "✓" | "✔" | "☑" | "☒" => Some(true),
        "non" | "no" | "faux" | "false" | "✗" | "✘" | "☐" => Some(false),
        _ => None,
    }
}

pub(crate) fn fold_accents(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'û' | 'ù' | 'ü' => 'u',
            'à' | 'â' => 'a',
            'î' | 'ï' => 'i',
            'ô' => 'o',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

pub(crate) fn month_named(word: &str) -> Option<u8> {
    let word = word.trim_end_matches(['.', ',']);
    Lang::ALL.iter().find_map(|lang| {
        lang.data()
            .months
            .iter()
            .find(|(name, _)| *name == word)
            .map(|(_, month)| *month)
    })
}

pub(crate) fn weekday_named(word: &str) -> Option<usize> {
    let word = word.trim_end_matches(',');
    Lang::ALL
        .iter()
        .find_map(|lang| lang.data().weekdays.iter().position(|day| *day == word))
}

pub(crate) fn day_number(word: &str) -> Option<u8> {
    let word = word.trim_end_matches(',');
    let digits = Lang::ALL
        .iter()
        .flat_map(|lang| lang.data().ordinal_suffixes)
        .find_map(|suffix| word.strip_suffix(suffix))
        .unwrap_or(word);
    digits.parse().ok()
}

fn expand_year(text: &str) -> Option<i32> {
    let year: i32 = text.parse().ok()?;
    match text.len() {
        2 => Some(2000 + year),
        4 => Some(year),
        _ => None,
    }
}

fn parse_numeric_date(text: &str, today: Day) -> Option<Day> {
    let separator = ['/', '-', '.'].into_iter().find(|s| text.contains(*s))?;
    let parts: Vec<&str> = text.split(separator).collect();
    if !parts
        .iter()
        .all(|p| !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    match parts.as_slice() {
        [year, month, day] if year.len() == 4 => {
            Day::new(year.parse().ok()?, month.parse().ok()?, day.parse().ok()?)
        }
        [day, month, year] if day.len() <= 2 && month.len() <= 2 => {
            Day::new(expand_year(year)?, month.parse().ok()?, day.parse().ok()?)
        }
        [day, month] if separator == '/' && day.len() <= 2 && month.len() <= 2 => {
            Day::new(today.year, month.parse().ok()?, day.parse().ok()?)
        }
        _ => None,
    }
}

fn parse_named_date(text: &str, today: Day) -> Option<Day> {
    let folded = fold_accents(&text.to_lowercase());
    let mut words: Vec<&str> = folded.split_whitespace().collect();
    if words.first().is_some_and(|w| weekday_named(w).is_some()) {
        words.remove(0);
    }
    let year = |w: &str| -> Option<i32> { (w.len() == 4).then(|| w.parse().ok()).flatten() };
    match words.as_slice() {
        [first, second] => match month_named(second) {
            Some(month) => Day::new(today.year, month, day_number(first)?),
            None => Day::new(today.year, month_named(first)?, day_number(second)?),
        },
        [first, second, third] => match month_named(second) {
            Some(month) => Day::new(year(third)?, month, day_number(first)?),
            None => Day::new(year(third)?, month_named(first)?, day_number(second)?),
        },
        _ => None,
    }
}

pub fn parse_date(text: &str, today: Day) -> Option<Day> {
    let text = text.trim();
    Day::parse_iso(text)
        .or_else(|| parse_numeric_date(text, today))
        .or_else(|| parse_named_date(text, today))
        .or_else(|| parse_relative_date(text, today))
}

fn parse_relative_date(text: &str, today: Day) -> Option<Day> {
    let folded = fold_accents(&text.to_lowercase()).replace('’', "'");
    let mut words: Vec<&str> = folded.split_whitespace().collect();
    let languages = || Lang::ALL.iter().map(|lang| lang.data());
    if words
        .first()
        .is_some_and(|w| languages().any(|data| data.day_articles.contains(w)))
    {
        words.remove(0);
    }
    let is_next = |w: Option<&&str>| w.is_some_and(|w| languages().any(|data| data.next == *w));
    let next_week = is_next(words.first()) || is_next(words.last());
    if next_week {
        words.retain(|w| !languages().any(|data| data.next == *w));
    }
    let [word] = words.as_slice() else {
        return None;
    };
    let relative = languages().find_map(|data| {
        data.relative_days
            .iter()
            .find(|(name, _)| name == word)
            .map(|(_, offset)| *offset)
    });
    if let Some(offset) = relative {
        return (!next_week).then(|| today.plus_days(offset)).flatten();
    }
    let target = weekday_named(word)?;
    let ahead =
        (i64::try_from(target).ok()? - i64::from(today.weekday_from_monday())).rem_euclid(7);
    let ahead = if next_week && ahead == 0 { 7 } else { ahead };
    today.plus_days(ahead)
}

fn group_thousands(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 * 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(NNBSP);
        }
        out.push(c);
    }
    out
}

pub fn format_decimal(value: Decimal) -> String {
    let negative = value.units < 0;
    let digits = value.units.unsigned_abs().to_string();
    let scale = usize::from(value.scale);
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (integer, fraction) = padded.split_at(padded.len() - scale);
    let sign = if negative { "-" } else { "" };
    match fraction {
        "" => format!("{sign}{}", group_thousands(integer)),
        _ => format!("{sign}{},{fraction}", group_thousands(integer)),
    }
}

pub fn format_money(minor: i64, currency: Currency) -> String {
    format!(
        "{}{NBSP}{}",
        format_decimal(Decimal {
            units: minor,
            scale: 2
        }),
        currency.symbol()
    )
}

pub fn format_percent(value: Decimal) -> String {
    format!("{}{NNBSP}%", format_decimal(value))
}

pub fn format_date(day: Day) -> String {
    format!("{:02}/{:02}/{:04}", day.day, day.month, day.year)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: Day = Day {
        year: 2026,
        month: 11,
        day: 11,
    };

    fn dec(units: i64, scale: u8) -> Option<Decimal> {
        Some(Decimal { units, scale })
    }

    #[test]
    fn reads_french_and_english_numbers() {
        assert_eq!(parse_decimal("1 200,50"), dec(120050, 2));
        assert_eq!(parse_decimal("1\u{202f}200,50"), dec(120050, 2));
        assert_eq!(parse_decimal("1\u{a0}234\u{a0}567"), dec(1234567, 0));
        assert_eq!(parse_decimal("12,5"), dec(125, 1));
        assert_eq!(parse_decimal("1.200"), dec(1200, 0));
        assert_eq!(parse_decimal("3.5"), dec(35, 1));
        assert_eq!(parse_decimal("1,200.50"), dec(120050, 2));
        assert_eq!(parse_decimal("1.200,50"), dec(120050, 2));
        assert_eq!(parse_decimal("1'000"), dec(1000, 0));
        assert_eq!(parse_decimal("-42"), dec(-42, 0));
        assert_eq!(parse_decimal("\u{2212}3,5"), dec(-35, 1));
    }

    #[test]
    fn rejects_what_is_not_a_number() {
        for text in [
            "",
            "abc",
            "12 34",
            "1 2345",
            "12,",
            "1,2,3",
            "12a",
            "--1",
            "1 200 000 000 000 000 000",
        ] {
            assert_eq!(parse_decimal(text), None, "{text:?}");
        }
    }

    #[test]
    fn reads_money_in_minor_units() {
        assert_eq!(
            parse_money("1 200,50 €", None),
            Some((120050, Currency::Eur, true))
        );
        assert_eq!(
            parse_money("850 €", None),
            Some((85000, Currency::Eur, true))
        );
        assert_eq!(
            parse_money("€1,200.50", None),
            Some((120050, Currency::Eur, true))
        );
        assert_eq!(
            parse_money("EUR 300", None),
            Some((30000, Currency::Eur, true))
        );
        assert_eq!(
            parse_money("12 chf", None),
            Some((1200, Currency::Chf, true))
        );
        assert_eq!(
            parse_money("-15,90 $", None),
            Some((-1590, Currency::Usd, true))
        );
        assert_eq!(
            parse_money("850", Some(Currency::Eur)),
            Some((85000, Currency::Eur, false))
        );
        assert_eq!(parse_money("850", None), None);
        assert_eq!(parse_money("1,234 €", None), None);
    }

    #[test]
    fn reads_percent_and_checkbox() {
        assert_eq!(parse_percent("12,5 %"), dec(125, 1));
        assert_eq!(parse_percent("12%"), dec(12, 0));
        assert_eq!(parse_percent("12"), None);
        assert_eq!(parse_checkbox("Oui"), Some(true));
        assert_eq!(parse_checkbox("non"), Some(false));
        assert_eq!(parse_checkbox("1"), None);
    }

    #[test]
    fn reads_dates() {
        let day = |y, m, d| Day::new(y, m, d);
        assert_eq!(parse_date("12/03/2026", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("12/03/26", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("12/03", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("2026-03-12", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("12.03.2026", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("3 mars 2026", TODAY), day(2026, 3, 3));
        assert_eq!(parse_date("1er février", TODAY), day(2026, 2, 1));
        assert_eq!(parse_date("jeudi 12 mars", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("29/02/2028", TODAY), day(2028, 2, 29));
        for text in [
            "29/02/2026",
            "32/01/2026",
            "12.03",
            "12-03",
            "mars",
            "12 brumaire",
        ] {
            assert_eq!(parse_date(text, TODAY), None, "{text:?}");
        }
    }

    #[test]
    fn reads_days_relative_to_today() {
        let day = |y, m, d| Day::new(y, m, d);
        assert_eq!(TODAY.weekday_from_monday(), 2);
        assert_eq!(parse_date("demain", TODAY), day(2026, 11, 12));
        assert_eq!(parse_date("Hier", TODAY), day(2026, 11, 10));
        assert_eq!(parse_date("aujourd’hui", TODAY), day(2026, 11, 11));
        assert_eq!(parse_date("le lundi", TODAY), day(2026, 11, 16));
        assert_eq!(parse_date("mercredi", TODAY), day(2026, 11, 11));
        assert_eq!(parse_date("mercredi prochain", TODAY), day(2026, 11, 18));
        assert_eq!(parse_date("dimanche", TODAY), day(2026, 11, 15));
        assert_eq!(parse_date("le mercerid", TODAY), None);
        assert_eq!(parse_date("demain prochain", TODAY), None);
    }

    #[test]
    fn reads_english_dates_too() {
        let day = |y, m, d| Day::new(y, m, d);
        assert_eq!(parse_date("March 3, 2026", TODAY), day(2026, 3, 3));
        assert_eq!(parse_date("3rd March", TODAY), day(2026, 3, 3));
        assert_eq!(parse_date("Thursday, March 12", TODAY), day(2026, 3, 12));
        assert_eq!(parse_date("tomorrow", TODAY), day(2026, 11, 12));
        assert_eq!(parse_date("on Monday", TODAY), day(2026, 11, 16));
        assert_eq!(parse_date("next Wednesday", TODAY), day(2026, 11, 18));
        assert_eq!(parse_date("lundi 16 novembre", TODAY), day(2026, 11, 16));
    }

    #[test]
    fn counts_days_across_months_and_years() {
        let day = |y, m, d| Day::new(y, m, d);
        assert_eq!(TODAY.plus_days(20), day(2026, 12, 1));
        assert_eq!(TODAY.plus_days(51), day(2027, 1, 1));
        assert_eq!(
            day(2028, 2, 28).and_then(|d| d.plus_days(1)),
            day(2028, 2, 29)
        );
        assert_eq!(
            day(2026, 3, 1).and_then(|d| d.plus_days(-1)),
            day(2026, 2, 28)
        );
    }

    #[test]
    fn formats_the_french_way() {
        assert_eq!(
            format_money(120050, Currency::Eur),
            "1\u{202f}200,50\u{a0}€"
        );
        assert_eq!(format_money(-5, Currency::Usd), "-0,05\u{a0}$");
        assert_eq!(
            format_decimal(Decimal {
                units: 1234567,
                scale: 0
            }),
            "1\u{202f}234\u{202f}567"
        );
        assert_eq!(
            format_percent(Decimal {
                units: 125,
                scale: 1
            }),
            "12,5\u{202f}%"
        );
        assert_eq!(
            format_date(Day {
                year: 2026,
                month: 3,
                day: 2
            }),
            "02/03/2026"
        );
    }

    #[test]
    fn adds_decimals_exactly() {
        let a = Decimal { units: 1, scale: 1 };
        let b = Decimal { units: 2, scale: 1 };
        assert_eq!(a.checked_add(b), dec(3, 1));
        assert_eq!(
            Decimal {
                units: 15,
                scale: 1
            }
            .checked_add(Decimal { units: 3, scale: 0 }),
            dec(45, 1)
        );
        assert_eq!(
            Decimal {
                units: 15,
                scale: 1
            }
            .compare(Decimal { units: 1, scale: 0 }),
            Ordering::Greater
        );
        assert_eq!(
            Decimal {
                units: 10,
                scale: 1
            }
            .compare(Decimal { units: 1, scale: 0 }),
            Ordering::Equal
        );
    }
}
