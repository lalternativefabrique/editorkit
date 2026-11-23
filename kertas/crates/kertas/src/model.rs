use std::collections::HashMap;

use crate::lang::Lang;
use serde::{Deserialize, Serialize};

use crate::values::{
    Currency, Day, Decimal, format_date, format_decimal, format_money, format_percent,
    parse_checkbox, parse_date, parse_decimal, parse_money, parse_percent,
};

const TYPE_VOTE_THRESHOLD: f64 = 0.8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PropertyType {
    Text,
    Number,
    Money { currency: Currency },
    Percent,
    Date,
    Checkbox,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Typed {
    Number(Decimal),
    Money { minor: i64, currency: Currency },
    Percent(Decimal),
    Date { iso: String },
    Checkbox { checked: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Value {
    pub raw: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typed: Option<Typed>,
    #[serde(default)]
    pub display: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Column {
    pub name: String,
    pub property: PropertyType,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub manual: bool,
    /// Computes every cell of the column from the other columns of its row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_error: Option<String>,
    /// Pixels, when the column was resized by hand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
}

impl Column {
    pub fn new(name: impl Into<String>, property: PropertyType) -> Self {
        Column {
            name: name.into(),
            property,
            manual: false,
            formula: None,
            formula_error: None,
            width: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Table {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Context {
    #[serde(with = "iso_day")]
    pub today: Day,
    #[serde(default)]
    pub lang: Lang,
}

mod iso_day {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};

    use crate::values::Day;

    pub fn serialize<S: Serializer>(day: &Day, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(day)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Day, D::Error> {
        Day::try_from(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

fn typed_as(raw: &str, property: PropertyType, context: Context) -> Option<Typed> {
    match property {
        PropertyType::Text => None,
        PropertyType::Number => parse_decimal(raw).map(Typed::Number),
        PropertyType::Money { currency } => parse_money(raw, Some(currency))
            .map(|(minor, currency, _)| Typed::Money { minor, currency }),
        PropertyType::Percent => parse_percent(raw)
            .or_else(|| parse_decimal(raw))
            .map(Typed::Percent),
        PropertyType::Date => parse_date(raw, context.today).map(|day| Typed::Date {
            iso: day.to_string(),
        }),
        PropertyType::Checkbox => parse_checkbox(raw).map(|checked| Typed::Checkbox { checked }),
    }
}

pub fn display_of(typed: &Typed) -> String {
    match typed {
        Typed::Number(value) => format_decimal(*value),
        Typed::Money { minor, currency } => format_money(*minor, *currency),
        Typed::Percent(value) => format_percent(*value),
        Typed::Date { iso } => Day::parse_iso(iso)
            .map(format_date)
            .unwrap_or_else(|| iso.clone()),
        Typed::Checkbox { checked } => if *checked { "✓" } else { "" }.to_string(),
    }
}

pub fn type_value(raw: &str, property: PropertyType, context: Context) -> Value {
    let raw = raw.trim().to_string();
    let typed = if raw.is_empty() {
        None
    } else {
        typed_as(&raw, property, context)
    };
    let display = typed
        .as_ref()
        .map(display_of)
        .unwrap_or_else(|| raw.clone());
    Value {
        raw,
        typed,
        display,
    }
}

fn share_at_least(hits: usize, total: usize) -> bool {
    total > 0 && hits as f64 / total as f64 >= TYPE_VOTE_THRESHOLD
}

fn majority_currency(cells: &[&str]) -> Option<Currency> {
    let mut votes: HashMap<Currency, usize> = HashMap::new();
    for cell in cells {
        if let Some((_, currency, true)) = parse_money(cell, None) {
            *votes.entry(currency).or_default() += 1;
        }
    }
    let mut ranked: Vec<(Currency, usize)> = votes.into_iter().collect();
    ranked.sort_by_key(|(currency, count)| {
        (
            std::cmp::Reverse(*count),
            Currency::ALL.iter().position(|c| c == currency),
        )
    });
    ranked.first().map(|(currency, _)| *currency)
}

pub fn infer_property(cells: &[&str], context: Context) -> PropertyType {
    let filled: Vec<&str> = cells
        .iter()
        .map(|c| c.trim())
        .filter(|c| !c.is_empty())
        .collect();
    let total = filled.len();
    let count = |accepts: &dyn Fn(&str) -> bool| filled.iter().filter(|c| accepts(c)).count();

    if share_at_least(count(&|c| parse_checkbox(c).is_some()), total) {
        return PropertyType::Checkbox;
    }
    if share_at_least(count(&|c| parse_date(c, context.today).is_some()), total) {
        return PropertyType::Date;
    }
    if share_at_least(count(&|c| parse_percent(c).is_some()), total) {
        return PropertyType::Percent;
    }
    if let Some(currency) = majority_currency(&filled)
        && share_at_least(count(&|c| parse_money(c, Some(currency)).is_some()), total)
    {
        return PropertyType::Money { currency };
    }
    if share_at_least(count(&|c| parse_decimal(c).is_some()), total) {
        return PropertyType::Number;
    }
    PropertyType::Text
}

pub fn retype(raws: &[String], property: PropertyType, context: Context) -> Vec<Value> {
    raws.iter()
        .map(|raw| type_value(raw, property, context))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };

    #[test]
    fn votes_a_column_type() {
        let infer = |cells: &[&str]| infer_property(cells, CONTEXT);
        assert_eq!(infer(&["oui", "non", "Oui"]), PropertyType::Checkbox);
        assert_eq!(
            infer(&["12/03/2026", "15/03", "1er avril"]),
            PropertyType::Date
        );
        assert_eq!(infer(&["12 %", "8,5 %"]), PropertyType::Percent);
        assert_eq!(
            infer(&["1 200,50 €", "850 €", "300"]),
            PropertyType::Money {
                currency: Currency::Eur
            }
        );
        assert_eq!(
            infer(&["10 $", "12 $", "3 €"]),
            PropertyType::Money {
                currency: Currency::Usd
            }
        );
        assert_eq!(infer(&["12", "3,5", "1 000"]), PropertyType::Number);
        assert_eq!(infer(&["Paul", "Anne"]), PropertyType::Text);
        assert_eq!(
            infer(&["12", "13", "14", "15", "n/a"]),
            PropertyType::Number
        );
        assert_eq!(infer(&["12", "13", "n/a"]), PropertyType::Text);
        assert_eq!(infer(&["", "  "]), PropertyType::Text);
    }

    #[test]
    fn retyping_keeps_what_was_typed() {
        let raws = vec!["1 200,50 €".to_string(), "Paul".to_string()];
        let as_number = retype(&raws, PropertyType::Number, CONTEXT);
        assert_eq!(as_number[0].typed, None);
        assert_eq!(as_number[0].raw, "1 200,50 €");
        assert_eq!(as_number[1].display, "Paul");

        let as_money = retype(
            &raws,
            PropertyType::Money {
                currency: Currency::Eur,
            },
            CONTEXT,
        );
        assert_eq!(
            as_money[0].typed,
            Some(Typed::Money {
                minor: 120050,
                currency: Currency::Eur
            })
        );
        assert_eq!(as_money[0].display, "1\u{202f}200,50\u{a0}€");

        let back_to_text = retype(
            &as_money.iter().map(|v| v.raw.clone()).collect::<Vec<_>>(),
            PropertyType::Text,
            CONTEXT,
        );
        assert_eq!(back_to_text[0].display, "1 200,50 €");
    }

    #[test]
    fn a_cell_keeps_its_own_currency() {
        let value = type_value(
            "50 $",
            PropertyType::Money {
                currency: Currency::Eur,
            },
            CONTEXT,
        );
        assert_eq!(
            value.typed,
            Some(Typed::Money {
                minor: 5000,
                currency: Currency::Usd
            })
        );
    }

    #[test]
    fn values_cross_the_boundary_as_json() -> Result<(), serde_json::Error> {
        let value = type_value("12/03", PropertyType::Date, CONTEXT);
        let json = serde_json::to_string(&value)?;
        assert_eq!(
            json,
            r#"{"raw":"12/03","typed":{"type":"date","iso":"2026-03-12"},"display":"12/03/2026"}"#
        );
        let money = serde_json::to_string(&PropertyType::Money {
            currency: Currency::Eur,
        })?;
        assert_eq!(money, r#"{"type":"money","currency":"EUR"}"#);
        let number =
            serde_json::to_string(&type_value("3,5", PropertyType::Number, CONTEXT).typed)?;
        assert_eq!(number, r#"{"type":"number","units":35,"scale":1}"#);
        Ok(())
    }
}
