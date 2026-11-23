use serde::{Deserialize, Serialize};

use crate::lang::{Lang, Language, detect};
use crate::model::{PropertyType, Table, Typed};
use crate::values::{
    Currency, Decimal, fold_accents, format_decimal, format_money, format_percent,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Measure {
    Count,
    Sum,
    Mean,
    Median,
    Min,
    Max,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Answer {
    pub lang: Lang,
    pub measure: Measure,
    pub column: usize,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Unit {
    Number(u8),
    Percent(u8),
    Money(Currency),
}

fn measure_in(question: &str) -> Option<(Measure, &'static Language)> {
    let padded = format!(" {question} ");
    let spoken = detect(question);
    let mut best: Option<(usize, bool, Measure, &'static Language)> = None;
    for language in Lang::ALL.iter().map(|lang| lang.data()) {
        for (keyword, measure) in language.measures {
            if !padded.contains(&format!(" {keyword} ")) {
                continue;
            }
            let candidate = (
                keyword.len(),
                spoken == Some(language.lang),
                *measure,
                language,
            );
            let better =
                best.is_none_or(|(len, matches, ..)| (candidate.0, candidate.1) > (len, matches));
            if better {
                best = Some(candidate);
            }
        }
    }
    best.map(|(_, _, measure, language)| (measure, language))
}

fn normalized(text: &str) -> String {
    fold_accents(&text.to_lowercase())
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn amounts(table: &Table, column: usize) -> Option<(Unit, Vec<(usize, i128)>)> {
    let mut unit = None;
    let mut values = Vec::new();
    for (row, cells) in table.rows.iter().enumerate() {
        let (this, units) = match cells.get(column).and_then(|v| v.typed.as_ref()) {
            Some(Typed::Number(d)) => (Unit::Number(d.scale), i128::from(d.units)),
            Some(Typed::Percent(d)) => (Unit::Percent(d.scale), i128::from(d.units)),
            Some(Typed::Money { minor, currency }) => (Unit::Money(*currency), i128::from(*minor)),
            _ => continue,
        };
        let unit = *unit.get_or_insert(this);
        let rescaled = match (unit, this) {
            (Unit::Money(a), Unit::Money(b)) if a == b => units,
            (Unit::Number(scale), Unit::Number(own))
            | (Unit::Percent(scale), Unit::Percent(own)) => rescale(units, own, scale)?,
            _ => continue,
        };
        values.push((row, rescaled));
    }
    unit.map(|unit| (unit, values))
}

fn rescale(units: i128, from: u8, to: u8) -> Option<i128> {
    if to >= from {
        units.checked_mul(10i128.checked_pow(u32::from(to - from))?)
    } else {
        Some(units / 10i128.checked_pow(u32::from(from - to))?)
    }
}

fn divide_rounded(total: i128, count: i128) -> i128 {
    let half = count / 2;
    if total >= 0 {
        (total + half) / count
    } else {
        (total - half) / count
    }
}

fn format_amount(unit: Unit, units: i128, extra_scale: u8) -> Option<String> {
    let decimal = |scale: u8| -> Option<Decimal> {
        Some(Decimal {
            units: i64::try_from(units).ok()?,
            scale,
        })
    };
    Some(match unit {
        Unit::Money(currency) => format_money(i64::try_from(units).ok()?, currency),
        Unit::Number(scale) => format_decimal(decimal(scale + extra_scale)?),
        Unit::Percent(scale) => format_percent(decimal(scale + extra_scale)?),
    })
}

fn label_of(table: &Table, row: usize, measured: usize) -> Option<String> {
    let label = table
        .columns
        .iter()
        .enumerate()
        .find(|(i, c)| *i != measured && c.property == PropertyType::Text)
        .and_then(|(i, _)| table.rows.get(row)?.get(i))
        .map(|v| v.raw.trim().to_string())?;
    (!label.is_empty()).then_some(label)
}

fn pick_column(table: &Table, question: &str) -> Option<usize> {
    let is_measure = |p: PropertyType| {
        matches!(
            p,
            PropertyType::Number | PropertyType::Money { .. } | PropertyType::Percent
        )
    };
    let named = table.columns.iter().position(|c| {
        is_measure(c.property)
            && format!(" {question} ").contains(&format!(" {} ", normalized(&c.name)))
    });
    named
        .or_else(|| {
            table
                .columns
                .iter()
                .position(|c| matches!(c.property, PropertyType::Money { .. }))
        })
        .or_else(|| table.columns.iter().position(|c| is_measure(c.property)))
}

pub fn answer(table: &Table, question: &str) -> Option<Answer> {
    let question = normalized(question);
    let (measure, language) = measure_in(&question)?;
    let column = pick_column(table, &question)?;
    compute(table, column, measure, language.lang)
}

pub fn compute(table: &Table, column: usize, measure: Measure, lang: Lang) -> Option<Answer> {
    let labels = &lang.data().labels;
    let name = &table.columns.get(column)?.name;
    let (unit, values) = amounts(table, column)?;
    let count = values.len();
    if count == 0 {
        return None;
    }
    let rows = if count > 1 { labels.rows } else { labels.row };
    let line = |title: &str, value: String| {
        format!(
            "{title} ({name}){}{value} {} {count} {rows}",
            labels.colon, labels.over
        )
    };
    let total: i128 = values.iter().map(|(_, v)| v).sum();
    let text = match measure {
        Measure::Count => format!("{} ({name}){}{count}", labels.count, labels.colon),
        Measure::Sum => line(labels.total, format_amount(unit, total, 0)?),
        Measure::Mean => {
            let (scaled, extra) = match unit {
                Unit::Money(_) => (total, 0),
                _ => (total * 100, 2),
            };
            let mean = divide_rounded(scaled, i128::try_from(count).ok()?);
            line(labels.mean, format_amount(unit, mean, extra)?)
        }
        Measure::Median => {
            let mut sorted: Vec<i128> = values.iter().map(|(_, v)| *v).collect();
            sorted.sort_unstable();
            let middle = sorted.len() / 2;
            let median = if sorted.len() % 2 == 1 {
                sorted[middle] * 100
            } else {
                divide_rounded((sorted[middle - 1] + sorted[middle]) * 100, 2)
            };
            let (value, extra) = match unit {
                Unit::Money(_) => (divide_rounded(median, 100), 0),
                _ => (median, 2),
            };
            line(labels.median, format_amount(unit, value, extra)?)
        }
        Measure::Max | Measure::Min => {
            let pick = if measure == Measure::Max {
                values.iter().max_by_key(|(_, v)| *v)
            } else {
                values.iter().min_by_key(|(_, v)| *v)
            };
            let (row, value) = pick?;
            let title = if measure == Measure::Max {
                labels.maximum
            } else {
                labels.minimum
            };
            let amount = format_amount(unit, *value, 0)?;
            match label_of(table, *row, column) {
                Some(label) => format!("{title} ({name}){}{amount}, {label}", labels.colon),
                None => format!("{title} ({name}){}{amount}", labels.colon),
            }
        }
    };
    Some(Answer {
        lang,
        measure,
        column,
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Context;
    use crate::table::detect_table;
    use crate::values::Day;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };

    fn profit() -> Table {
        detect_table(
            "Mois\tMontant\njanvier\t1 200 €\nfévrier\t900 €\nmars\t1 500 €\ndemain\t299 €",
            CONTEXT,
        )
        .map(|(table, _)| table)
        .unwrap_or_else(|| unreachable!("table"))
    }

    fn said(question: &str) -> Option<String> {
        answer(&profit(), question).map(|a| a.text)
    }

    #[test]
    fn answers_the_mean_of_the_money_column() {
        assert_eq!(
            said("analyse le coût moyen ?").as_deref(),
            Some("Moyenne (Montant)\u{a0}: 974,75\u{a0}€ sur 4 lignes")
        );
    }

    #[test]
    fn answers_totals_extremes_and_medians() {
        assert_eq!(
            said("quel est le total").as_deref(),
            Some("Total (Montant)\u{a0}: 3\u{202f}899,00\u{a0}€ sur 4 lignes")
        );
        assert_eq!(
            said("le mois le plus élevé ?").as_deref(),
            Some("Maximum (Montant)\u{a0}: 1\u{202f}500,00\u{a0}€, mars")
        );
        assert_eq!(
            said("et le minimum").as_deref(),
            Some("Minimum (Montant)\u{a0}: 299,00\u{a0}€, demain")
        );
        assert_eq!(
            said("la médiane").as_deref(),
            Some("Médiane (Montant)\u{a0}: 1\u{202f}050,00\u{a0}€ sur 4 lignes")
        );
    }

    #[test]
    fn averages_plain_numbers_with_two_decimals() {
        let scores = detect_table("Nom\tNote\nA\t12\nB\t15\nC\t14", CONTEXT)
            .map(|(table, _)| table)
            .unwrap_or_else(|| unreachable!("table"));
        assert_eq!(
            answer(&scores, "note moyenne").map(|a| a.text).as_deref(),
            Some("Moyenne (Note)\u{a0}: 13,67 sur 3 lignes")
        );
    }

    #[test]
    fn answers_in_the_language_of_the_question() {
        assert_eq!(
            said("what is the average cost?").as_deref(),
            Some("Average (Montant): 974,75\u{a0}€ over 4 rows")
        );
        assert_eq!(
            said("which month is the highest").as_deref(),
            Some("Maximum (Montant): 1\u{202f}500,00\u{a0}€, mars")
        );
    }

    #[test]
    fn computes_a_measure_directly() {
        let mut table = profit();
        let before = compute(&table, 1, Measure::Sum, Lang::Fr).map(|a| a.text);
        table.rows.truncate(2);
        let after = compute(&table, 1, Measure::Sum, Lang::Fr).map(|a| a.text);
        assert_eq!(
            before.as_deref(),
            Some("Total (Montant)\u{a0}: 3\u{202f}899,00\u{a0}€ sur 4 lignes")
        );
        assert_eq!(
            after.as_deref(),
            Some("Total (Montant)\u{a0}: 2\u{202f}100,00\u{a0}€ sur 2 lignes")
        );
        assert_eq!(compute(&table, 0, Measure::Sum, Lang::Fr), None);
        assert_eq!(compute(&table, 9, Measure::Sum, Lang::Fr), None);
    }

    #[test]
    fn ignores_text_without_a_measure() {
        assert_eq!(said("mars sera un bon mois"), None);
        assert_eq!(said("Le minimalisme est à la mode"), None);
    }
}
