use serde::{Deserialize, Serialize};

use crate::moment::MomentKind;
use crate::stats::Measure;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    Fr,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Typography {
    French,
    English,
}

pub struct Labels {
    pub name: &'static str,
    pub text: &'static str,
    pub number: &'static str,
    pub amount: &'static str,
    pub percent: &'static str,
    pub date: &'static str,
    pub done: &'static str,
    pub column: &'static str,
    pub others: &'static str,
    pub by: &'static str,
    pub total: &'static str,
    pub mean: &'static str,
    pub median: &'static str,
    pub maximum: &'static str,
    pub minimum: &'static str,
    pub count: &'static str,
    pub over: &'static str,
    pub row: &'static str,
    pub rows: &'static str,
    pub colon: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Span {
    Days,
    Weeks,
    Months,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeriodEnd {
    Week,
    Month,
}

pub struct Language {
    pub lang: Lang,
    pub stopwords: &'static [&'static str],
    pub accents: &'static str,
    pub months: &'static [(&'static str, u8)],
    pub weekdays: [&'static str; 7],
    pub relative_days: &'static [(&'static str, i64)],
    pub next: &'static str,
    pub day_articles: &'static [&'static str],
    pub ordinal_suffixes: &'static [&'static str],
    pub number_words: &'static [(&'static str, usize)],
    pub and: &'static str,
    pub table_words: &'static [&'static str],
    pub column_words: &'static [&'static str],
    pub row_words: &'static [&'static str],
    pub subject_markers: &'static [&'static str],
    pub measures: &'static [(&'static str, Measure)],
    pub foreign_locutions: &'static [&'static str],
    pub deadline_triggers: &'static [&'static str],
    pub citing_determiners: &'static [&'static str],
    pub citing_nouns: &'static [&'static str],
    pub not_cited: &'static [&'static str],
    pub elided: &'static [&'static str],
    pub letters: &'static str,
    pub moment_kinds: &'static [(&'static str, MomentKind, &'static [&'static str])],
    pub time_prefixes: &'static [&'static str],
    pub time_words: &'static [(&'static str, u8)],
    pub day_prefixes: &'static [&'static str],
    /// "dans" in "dans 2 semaines".
    pub ahead: &'static [&'static str],
    pub spans: &'static [(&'static str, Span)],
    pub period_ends: &'static [(&'static str, PeriodEnd)],
    /// Follows a weekday to mean the one a week later: "lundi en huit".
    pub week_later: &'static [&'static str],
    pub title_fillers: &'static [&'static str],
    pub typography: Typography,
    pub labels: Labels,
}

const LATIN: [&str; 17] = [
    "a priori",
    "a posteriori",
    "a fortiori",
    "ad hoc",
    "de facto",
    "de jure",
    "ex nihilo",
    "in extenso",
    "in extremis",
    "in situ",
    "ipso facto",
    "mutatis mutandis",
    "persona non grata",
    "sic",
    "sine qua non",
    "stricto sensu",
    "lato sensu",
];

static FRENCH: Language = Language {
    lang: Lang::Fr,
    stopwords: &[
        "le", "la", "les", "de", "des", "du", "un", "une", "et", "est", "en", "que", "qui", "pour",
        "dans", "sur", "pas", "avec", "ce", "il", "elle", "nous", "vous", "je", "au", "aux",
        "mais", "ou", "son", "sa", "ses", "sont", "tres", "aussi", "plus",
    ],
    accents: "éèêàçùœâîôû",
    months: &[
        ("janvier", 1),
        ("janv", 1),
        ("fevrier", 2),
        ("fevr", 2),
        ("fev", 2),
        ("mars", 3),
        ("avril", 4),
        ("avr", 4),
        ("mai", 5),
        ("juin", 6),
        ("juillet", 7),
        ("juil", 7),
        ("aout", 8),
        ("septembre", 9),
        ("sept", 9),
        ("sep", 9),
        ("octobre", 10),
        ("oct", 10),
        ("novembre", 11),
        ("nov", 11),
        ("decembre", 12),
        ("dec", 12),
    ],
    weekdays: [
        "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
    ],
    relative_days: &[
        ("aujourd'hui", 0),
        ("demain", 1),
        ("apres-demain", 2),
        ("hier", -1),
        ("avant-hier", -2),
    ],
    next: "prochain",
    day_articles: &["le", "ce"],
    ordinal_suffixes: &["er"],
    number_words: &[
        ("un", 1),
        ("une", 1),
        ("deux", 2),
        ("trois", 3),
        ("quatre", 4),
        ("cinq", 5),
        ("six", 6),
        ("sept", 7),
        ("huit", 8),
        ("neuf", 9),
        ("dix", 10),
        ("onze", 11),
        ("douze", 12),
        ("quinze", 15),
        ("vingt", 20),
        ("trente", 30),
        ("cinquante", 50),
        ("cent", 100),
    ],
    and: "et",
    table_words: &["tableau", "tableaux", "table"],
    column_words: &["colonne", "colonnes", "col", "cols"],
    row_words: &["ligne", "lignes", "rangee", "rangees"],
    subject_markers: &["montrant", "affichant", "sur", "pour", "concernant", "avec"],
    measures: &[
        ("moyen", Measure::Mean),
        ("moyenne", Measure::Mean),
        ("en moyenne", Measure::Mean),
        ("median", Measure::Median),
        ("mediane", Measure::Median),
        ("total", Measure::Sum),
        ("somme", Measure::Sum),
        ("au total", Measure::Sum),
        ("maximum", Measure::Max),
        ("max", Measure::Max),
        ("plus eleve", Measure::Max),
        ("plus haut", Measure::Max),
        ("plus gros", Measure::Max),
        ("meilleur", Measure::Max),
        ("minimum", Measure::Min),
        ("min", Measure::Min),
        ("plus bas", Measure::Min),
        ("plus faible", Measure::Min),
        ("plus petit", Measure::Min),
        ("pire", Measure::Min),
        ("combien de lignes", Measure::Count),
        ("nombre de lignes", Measure::Count),
    ],
    foreign_locutions: &[
        "a priori",
        "a posteriori",
        "a fortiori",
        "ad hoc",
        "ad vitam aeternam",
        "de facto",
        "de jure",
        "et cetera",
        "ex nihilo",
        "grosso modo",
        "in extenso",
        "in extremis",
        "in fine",
        "in situ",
        "ipso facto",
        "lato sensu",
        "manu militari",
        "modus operandi",
        "mutatis mutandis",
        "persona non grata",
        "sic",
        "sine qua non",
        "stricto sensu",
        "brainstorming",
        "best practices",
        "deadline",
        "feedback",
        "kick-off",
        "meeting",
        "onboarding",
        "roadmap",
        "timeline",
        "workshop",
    ],
    deadline_triggers: &[
        "au plus tard le",
        "au plus tard",
        "avant le",
        "avant",
        "d ici le",
        "d ici",
        "jusqu au",
        "date limite",
    ],
    citing_determiners: &["le", "du", "au", "ce"],
    citing_nouns: &["mot", "verbe"],
    not_cited: &[
        "a", "à", "au", "clé", "d", "dans", "de", "des", "du", "en", "est", "et", "était", "juste",
        "la", "le", "les", "magique", "ou", "pour", "que", "qui", "sera", "suivant", "sur", "un",
        "une",
    ],
    elided: &[
        "c", "d", "j", "l", "m", "n", "s", "t", "qu", "jusqu", "lorsqu", "puisqu",
    ],
    letters: "abcdefghijklmnopqrstuvwxyzàâçéèêëîïôûùüœ",
    moment_kinds: &[
        ("rappelle-moi", MomentKind::Reminder, &["de", "d'"]),
        ("rappelle moi", MomentKind::Reminder, &["de", "d'"]),
        ("n' oublie pas", MomentKind::Reminder, &["de", "d'"]),
        ("penser a", MomentKind::Reminder, &[]),
        ("rappel", MomentKind::Reminder, &[]),
        ("envoyer un mail", MomentKind::Mail, &["a"]),
        ("e-mail", MomentKind::Mail, &["a"]),
        ("email", MomentKind::Mail, &["a"]),
        ("mail", MomentKind::Mail, &["a"]),
        ("ecrire", MomentKind::Mail, &["a"]),
        ("envoyer", MomentKind::Mail, &["a"]),
        ("noter", MomentKind::Note, &["sur", "que"]),
        ("note", MomentKind::Note, &["sur", "que"]),
        ("rendez-vous", MomentKind::Appointment, &["avec", "chez"]),
        ("rdv", MomentKind::Appointment, &["avec", "chez"]),
    ],
    time_prefixes: &["a"],
    time_words: &[("midi", 12), ("minuit", 0)],
    day_prefixes: &["le"],
    ahead: &["dans"],
    spans: &[
        ("jour", Span::Days),
        ("jours", Span::Days),
        ("semaine", Span::Weeks),
        ("semaines", Span::Weeks),
        ("mois", Span::Months),
    ],
    period_ends: &[
        ("fin de la semaine", PeriodEnd::Week),
        ("fin de semaine", PeriodEnd::Week),
        ("fin du mois", PeriodEnd::Month),
        ("fin de mois", PeriodEnd::Month),
    ],
    week_later: &["en huit"],
    title_fillers: &["a", "de", "le", "la", "pour"],
    typography: Typography::French,
    labels: Labels {
        name: "Nom",
        text: "Texte",
        number: "Nombre",
        amount: "Montant",
        percent: "Pourcentage",
        date: "Date",
        done: "Fait",
        column: "Colonne",
        others: "Autres",
        by: "par",
        total: "Total",
        mean: "Moyenne",
        median: "Médiane",
        maximum: "Maximum",
        minimum: "Minimum",
        count: "Nombre de valeurs",
        over: "sur",
        row: "ligne",
        rows: "lignes",
        colon: "\u{a0}: ",
    },
};

static ENGLISH: Language = Language {
    lang: Lang::En,
    stopwords: &[
        "the", "and", "is", "are", "of", "to", "in", "it", "that", "for", "on", "with", "you",
        "this", "was", "be", "have", "has", "not", "but", "can", "will", "we", "they", "my",
        "your", "what", "at", "by", "from", "an", "or", "do",
    ],
    accents: "",
    months: &[
        ("january", 1),
        ("jan", 1),
        ("february", 2),
        ("feb", 2),
        ("march", 3),
        ("mar", 3),
        ("april", 4),
        ("apr", 4),
        ("may", 5),
        ("june", 6),
        ("jun", 6),
        ("july", 7),
        ("jul", 7),
        ("august", 8),
        ("aug", 8),
        ("september", 9),
        ("sept", 9),
        ("sep", 9),
        ("october", 10),
        ("oct", 10),
        ("november", 11),
        ("nov", 11),
        ("december", 12),
        ("dec", 12),
    ],
    weekdays: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ],
    relative_days: &[("today", 0), ("tomorrow", 1), ("yesterday", -1)],
    next: "next",
    day_articles: &["on", "this"],
    ordinal_suffixes: &["st", "nd", "rd", "th"],
    number_words: &[
        ("one", 1),
        ("a", 1),
        ("two", 2),
        ("three", 3),
        ("four", 4),
        ("five", 5),
        ("six", 6),
        ("seven", 7),
        ("eight", 8),
        ("nine", 9),
        ("ten", 10),
        ("eleven", 11),
        ("twelve", 12),
        ("fifteen", 15),
        ("twenty", 20),
        ("thirty", 30),
        ("fifty", 50),
        ("hundred", 100),
    ],
    and: "and",
    table_words: &["table", "tables", "spreadsheet"],
    column_words: &["column", "columns", "col", "cols"],
    row_words: &["row", "rows", "line", "lines"],
    subject_markers: &["showing", "about", "for", "on", "with", "of"],
    measures: &[
        ("average", Measure::Mean),
        ("mean", Measure::Mean),
        ("on average", Measure::Mean),
        ("median", Measure::Median),
        ("total", Measure::Sum),
        ("sum", Measure::Sum),
        ("in total", Measure::Sum),
        ("maximum", Measure::Max),
        ("max", Measure::Max),
        ("highest", Measure::Max),
        ("biggest", Measure::Max),
        ("best", Measure::Max),
        ("minimum", Measure::Min),
        ("min", Measure::Min),
        ("lowest", Measure::Min),
        ("smallest", Measure::Min),
        ("worst", Measure::Min),
        ("how many rows", Measure::Count),
        ("number of rows", Measure::Count),
    ],
    foreign_locutions: &LATIN,
    deadline_triggers: &["no later than", "by", "before", "until", "due", "deadline"],
    citing_determiners: &["the"],
    citing_nouns: &["word", "verb", "term"],
    not_cited: &[
        "a", "an", "and", "for", "in", "is", "of", "on", "or", "that", "the", "to", "was", "will",
    ],
    elided: &[],
    letters: "abcdefghijklmnopqrstuvwxyz",
    moment_kinds: &[
        ("remind me", MomentKind::Reminder, &["to", "about"]),
        ("don't forget", MomentKind::Reminder, &["to", "about"]),
        ("reminder", MomentKind::Reminder, &["to", "about"]),
        ("send an email", MomentKind::Mail, &["to"]),
        ("e-mail", MomentKind::Mail, &["to"]),
        ("email", MomentKind::Mail, &["to"]),
        ("mail", MomentKind::Mail, &["to"]),
        ("write", MomentKind::Mail, &["to"]),
        ("note", MomentKind::Note, &["about", "that", "on"]),
        ("appointment", MomentKind::Appointment, &["with", "at"]),
        ("appt", MomentKind::Appointment, &["with", "at"]),
    ],
    time_prefixes: &["at"],
    time_words: &[("noon", 12), ("midday", 12), ("midnight", 0)],
    day_prefixes: &["on", "next", "this", "the"],
    ahead: &["in"],
    spans: &[
        ("day", Span::Days),
        ("days", Span::Days),
        ("week", Span::Weeks),
        ("weeks", Span::Weeks),
        ("month", Span::Months),
        ("months", Span::Months),
    ],
    period_ends: &[
        ("end of the week", PeriodEnd::Week),
        ("end of week", PeriodEnd::Week),
        ("end of the month", PeriodEnd::Month),
        ("end of month", PeriodEnd::Month),
    ],
    week_later: &[],
    title_fillers: &["at", "on", "to", "for", "the", "with"],
    typography: Typography::English,
    labels: Labels {
        name: "Name",
        text: "Text",
        number: "Number",
        amount: "Amount",
        percent: "Percent",
        date: "Date",
        done: "Done",
        column: "Column",
        others: "Other",
        by: "by",
        total: "Total",
        mean: "Average",
        median: "Median",
        maximum: "Maximum",
        minimum: "Minimum",
        count: "Values",
        over: "over",
        row: "row",
        rows: "rows",
        colon: ": ",
    },
};

const MIN_EVIDENCE: usize = 2;

impl Lang {
    pub const ALL: [Lang; 2] = [Lang::Fr, Lang::En];

    pub fn data(self) -> &'static Language {
        match self {
            Lang::Fr => &FRENCH,
            Lang::En => &ENGLISH,
        }
    }

    pub fn index(self) -> usize {
        match self {
            Lang::Fr => 0,
            Lang::En => 1,
        }
    }
}

pub fn detect(text: &str) -> Option<Lang> {
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .collect();
    let mut scores: Vec<(Lang, usize)> = Lang::ALL
        .iter()
        .map(|lang| {
            let data = lang.data();
            let stopwords = words.iter().filter(|w| data.stopwords.contains(w)).count();
            let accents = lower.chars().filter(|c| data.accents.contains(*c)).count();
            (*lang, stopwords * 2 + accents)
        })
        .collect();
    scores.sort_by_key(|score| std::cmp::Reverse(score.1));
    match scores.as_slice() {
        [(best, top), (_, second), ..] if *top >= MIN_EVIDENCE * 2 && top > second => Some(*best),
        _ => None,
    }
}

pub fn lang_of(text: &str, fallback: Lang) -> Lang {
    detect(text).unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_french_from_english() {
        assert_eq!(
            detect("The meeting is on Monday, can you send the report before noon?"),
            Some(Lang::En)
        );
        assert_eq!(
            detect("Nous avons revu le budget de l’année avec toute l’équipe."),
            Some(Lang::Fr)
        );
        assert_eq!(detect("Il a été très clair"), Some(Lang::Fr));
    }

    #[test]
    fn stays_silent_on_too_little_text() {
        assert_eq!(detect("Budget 2027"), None);
        assert_eq!(detect("ok"), None);
        assert_eq!(lang_of("ok", Lang::En), Lang::En);
    }
}
