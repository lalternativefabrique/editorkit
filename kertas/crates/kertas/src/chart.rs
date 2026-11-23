use std::cmp::Ordering;

use serde::Serialize;

use crate::lang::Lang;
use crate::model::{PropertyType, Table, Typed};
use crate::values::{
    Currency, Day, Decimal, fold_accents, format_date, format_decimal, format_money,
    format_percent, month_named,
};

const MAX_CATEGORIES: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Axis {
    Category,
    Time,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Point {
    pub label: String,
    pub value: f64,
    pub display: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chart {
    pub x: usize,
    pub y: usize,
    pub axis: Axis,
    pub title: String,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Amount {
    Number(Decimal),
    Percent(Decimal),
    Money(i64, Currency),
}

impl Amount {
    fn of(typed: &Typed) -> Option<Amount> {
        match typed {
            Typed::Number(value) => Some(Amount::Number(*value)),
            Typed::Percent(value) => Some(Amount::Percent(*value)),
            Typed::Money { minor, currency } => Some(Amount::Money(*minor, *currency)),
            Typed::Date { .. } | Typed::Checkbox { .. } => None,
        }
    }

    fn plus(self, other: Amount) -> Option<Amount> {
        match (self, other) {
            (Amount::Number(a), Amount::Number(b)) => a.checked_add(b).map(Amount::Number),
            (Amount::Percent(a), Amount::Percent(b)) => a.checked_add(b).map(Amount::Percent),
            (Amount::Money(a, ca), Amount::Money(b, cb)) if ca == cb => {
                a.checked_add(b).map(|sum| Amount::Money(sum, ca))
            }
            _ => None,
        }
    }

    fn as_f64(self) -> f64 {
        let decimal = |d: Decimal| d.units as f64 / 10f64.powi(i32::from(d.scale));
        match self {
            Amount::Number(d) | Amount::Percent(d) => decimal(d),
            Amount::Money(minor, _) => minor as f64 / 100.0,
        }
    }

    fn display(self) -> String {
        match self {
            Amount::Number(d) => format_decimal(d),
            Amount::Percent(d) => format_percent(d),
            Amount::Money(minor, currency) => format_money(minor, currency),
        }
    }
}

fn is_measure(property: PropertyType) -> bool {
    matches!(
        property,
        PropertyType::Number | PropertyType::Money { .. } | PropertyType::Percent
    )
}

pub fn default_axes(table: &Table) -> Option<(usize, usize)> {
    let find =
        |wanted: fn(PropertyType) -> bool| table.columns.iter().position(|c| wanted(c.property));
    let y = find(|p| matches!(p, PropertyType::Money { .. }))
        .or_else(|| find(|p| p == PropertyType::Number))
        .or_else(|| find(|p| p == PropertyType::Percent))?;
    let x = find(|p| p == PropertyType::Date).or_else(|| {
        table
            .columns
            .iter()
            .enumerate()
            .position(|(i, c)| i != y && c.property == PropertyType::Text)
    })?;
    Some((x, y))
}

fn day_of(typed: Option<&Typed>) -> Option<Day> {
    match typed {
        Some(Typed::Date { iso }) => Day::parse_iso(iso),
        _ => None,
    }
}

pub fn chart(table: &Table, axes: Option<(usize, usize)>, lang: Lang) -> Option<Chart> {
    let labels = &lang.data().labels;
    let (x, y) = axes.or_else(|| default_axes(table))?;
    let (x_column, y_column) = (table.columns.get(x)?, table.columns.get(y)?);
    if x == y || !is_measure(y_column.property) {
        return None;
    }
    let axis = if x_column.property == PropertyType::Date {
        Axis::Time
    } else {
        Axis::Category
    };

    let mut groups: Vec<(String, Option<Day>, Amount)> = Vec::new();
    for row in &table.rows {
        let (Some(key), Some(amount)) = (
            row.get(x),
            row.get(y)
                .and_then(|v| v.typed.as_ref())
                .and_then(Amount::of),
        ) else {
            continue;
        };
        let day = day_of(key.typed.as_ref());
        if axis == Axis::Time && day.is_none() {
            continue;
        }
        let label = match day {
            Some(day) => format_date(day),
            None => key.raw.trim().to_string(),
        };
        if label.is_empty() {
            continue;
        }
        let same_unit = groups
            .first()
            .is_none_or(|first| first.2.plus(amount).is_some());
        if !same_unit {
            continue;
        }
        match groups.iter_mut().find(|(existing, ..)| *existing == label) {
            Some(group) => group.2 = group.2.plus(amount).unwrap_or(group.2),
            None => groups.push((label, day, amount)),
        }
    }

    let month_of = |label: &str| month_named(&fold_accents(&label.to_lowercase()));
    let months =
        axis == Axis::Category && groups.iter().all(|(label, ..)| month_of(label).is_some());
    let axis = if months { Axis::Time } else { axis };
    match axis {
        Axis::Time if months => groups.sort_by_key(|(label, ..)| month_of(label)),
        Axis::Time => groups.sort_by_key(|(_, day, _)| *day),
        Axis::Category => groups.sort_by(|a, b| {
            b.2.as_f64()
                .partial_cmp(&a.2.as_f64())
                .unwrap_or(Ordering::Equal)
        }),
    }
    if axis == Axis::Category && groups.len() > MAX_CATEGORIES {
        let rest = groups.split_off(MAX_CATEGORIES - 1);
        let folded = rest
            .iter()
            .skip(1)
            .try_fold(rest[0].2, |sum, (_, _, amount)| sum.plus(*amount));
        if let Some(total) = folded {
            groups.push((labels.others.to_string(), None, total));
        }
    }

    Some(Chart {
        x,
        y,
        axis,
        title: format!(
            "{} {} {}",
            y_column.name,
            labels.by,
            x_column.name.to_lowercase()
        ),
        points: groups
            .into_iter()
            .map(|(label, _, amount)| Point {
                label,
                value: amount.as_f64(),
                display: amount.display(),
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Context, Table};
    use crate::table::detect_table;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };

    fn table(text: &str) -> Table {
        detect_table(text, CONTEXT)
            .map(|(table, _)| table)
            .unwrap_or_else(|| unreachable!("table"))
    }

    fn points(chart: &Chart) -> Vec<(&str, &str)> {
        chart
            .points
            .iter()
            .map(|p| (p.label.as_str(), p.display.as_str()))
            .collect()
    }

    #[test]
    fn sums_an_amount_per_name_largest_first() {
        let sales = table("Client\tMontant\nPaul\t10 €\nAnne\t30 €\nPaul\t25,50 €");
        let chart = chart(&sales, None, Lang::Fr).unwrap_or_else(|| unreachable!("chart"));
        assert_eq!(chart.axis, Axis::Category);
        assert_eq!(chart.title, "Montant par client");
        assert_eq!(
            points(&chart),
            [("Paul", "35,50\u{a0}€"), ("Anne", "30,00\u{a0}€")]
        );
        assert_eq!(chart.points[0].value, 35.5);
    }

    #[test]
    fn puts_dates_in_time_order() {
        let sales = table("Date\tVentes\n15/03/2026\t5\n12/03/2026\t3\n15/03/2026\t1");
        let chart = chart(&sales, None, Lang::Fr).unwrap_or_else(|| unreachable!("chart"));
        assert_eq!(chart.axis, Axis::Time);
        assert_eq!(points(&chart), [("12/03/2026", "3"), ("15/03/2026", "6")]);
    }

    #[test]
    fn keeps_months_in_calendar_order() {
        let profit = table("Mois\tMontant\nmars\t1 500 €\njanvier\t1 200 €\nFévrier\t900 €");
        let chart = chart(&profit, None, Lang::Fr).unwrap_or_else(|| unreachable!("chart"));
        assert_eq!(chart.axis, Axis::Time);
        let labels: Vec<&str> = chart.points.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["janvier", "Février", "mars"]);
    }

    #[test]
    fn folds_the_long_tail_into_others() {
        let rows: String = (1..=20).map(|i| format!("\nP{i}\t{i}")).collect();
        let chart = chart(&table(&format!("Nom\tNombre{rows}")), None, Lang::Fr)
            .unwrap_or_else(|| unreachable!("chart"));
        assert_eq!(chart.points.len(), MAX_CATEGORIES);
        assert_eq!(chart.points[0].label, "P20");
        let others = chart
            .points
            .last()
            .unwrap_or_else(|| unreachable!("others"));
        assert_eq!((others.label.as_str(), others.value), ("Autres", 45.0));
    }

    #[test]
    fn needs_a_measure() {
        let names = table("Nom\tVille\nPaul\tLyon\nAnne\tNantes");
        assert_eq!(chart(&names, None, Lang::Fr), None);
        assert_eq!(
            chart(
                &table("Nom\tNombre\nPaul\t1\nAnne\t2"),
                Some((1, 0)),
                Lang::Fr
            ),
            None
        );
    }
}
