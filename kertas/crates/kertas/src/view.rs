use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{PropertyType, Table, Typed, Value};
use crate::values::{Currency, Decimal, format_decimal, format_money};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Sort {
    pub column: usize,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Total {
    pub display: String,
    pub values: Vec<Typed>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct View {
    pub order: Vec<usize>,
    pub totals: Vec<Option<Total>>,
}

fn fold_for_sorting(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

fn compare_typed(a: &Typed, b: &Typed) -> Ordering {
    match (a, b) {
        (Typed::Number(a), Typed::Number(b)) | (Typed::Percent(a), Typed::Percent(b)) => {
            a.compare(*b)
        }
        (
            Typed::Money {
                minor: a,
                currency: ca,
            },
            Typed::Money {
                minor: b,
                currency: cb,
            },
        ) => {
            let rank = |c: &Currency| Currency::ALL.iter().position(|x| x == c);
            rank(ca).cmp(&rank(cb)).then(a.cmp(b))
        }
        (Typed::Date { iso: a }, Typed::Date { iso: b }) => a.cmp(b),
        (Typed::Checkbox { checked: a }, Typed::Checkbox { checked: b }) => a.cmp(b),
        _ => Ordering::Equal,
    }
}

fn compare_values(a: &Value, b: &Value) -> Ordering {
    match (&a.typed, &b.typed) {
        (Some(x), Some(y)) => compare_typed(x, y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => fold_for_sorting(&a.raw).cmp(&fold_for_sorting(&b.raw)),
    }
}

fn sorted_order(table: &Table, sort: Option<Sort>) -> Vec<usize> {
    let mut order: Vec<usize> = (0..table.rows.len()).collect();
    let Some(sort) = sort.filter(|s| s.column < table.columns.len()) else {
        return order;
    };
    let cell = |row: usize| table.rows[row].get(sort.column);
    order.sort_by(|&a, &b| {
        let (Some(x), Some(y)) = (cell(a), cell(b)) else {
            return Ordering::Equal;
        };
        let untyped_last = x.typed.is_none() != y.typed.is_none();
        let ordering = compare_values(x, y);
        if sort.descending && !untyped_last {
            ordering.reverse()
        } else {
            ordering
        }
    });
    order
}

fn sum_numbers<'a>(mut values: impl Iterator<Item = &'a Typed>) -> Option<Decimal> {
    values.try_fold(Decimal { units: 0, scale: 0 }, |sum, typed| match typed {
        Typed::Number(value) => sum.checked_add(*value),
        _ => Some(sum),
    })
}

fn total_of(table: &Table, column: usize) -> Option<Total> {
    let typed = || {
        table
            .rows
            .iter()
            .filter_map(|row| row.get(column)?.typed.as_ref())
    };
    match table.columns.get(column)?.property {
        PropertyType::Number => {
            let sum = sum_numbers(typed())?;
            Some(Total {
                display: format_decimal(sum),
                values: vec![Typed::Number(sum)],
            })
        }
        PropertyType::Money { .. } => {
            let mut by_currency: BTreeMap<usize, (Currency, i64)> = BTreeMap::new();
            for value in typed() {
                if let Typed::Money { minor, currency } = value {
                    let rank = Currency::ALL
                        .iter()
                        .position(|c| c == currency)
                        .unwrap_or(usize::MAX);
                    let entry = by_currency.entry(rank).or_insert((*currency, 0));
                    entry.1 = entry.1.checked_add(*minor)?;
                }
            }
            let sums: Vec<(Currency, i64)> = by_currency.into_values().collect();
            let display = sums
                .iter()
                .map(|(currency, minor)| format_money(*minor, *currency))
                .collect::<Vec<_>>()
                .join(" + ");
            let values = sums
                .into_iter()
                .map(|(currency, minor)| Typed::Money { minor, currency })
                .collect();
            Some(Total { display, values })
        }
        PropertyType::Checkbox => {
            let checked = typed()
                .filter(|t| matches!(t, Typed::Checkbox { checked: true }))
                .count();
            Some(Total {
                display: format!("{checked}/{}", table.rows.len()),
                values: Vec::new(),
            })
        }
        PropertyType::Text | PropertyType::Percent | PropertyType::Date => None,
    }
}

pub fn view(table: &Table, sort: Option<Sort>) -> View {
    View {
        order: sorted_order(table, sort),
        totals: (0..table.columns.len())
            .map(|i| total_of(table, i))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Column, Context, type_value};
    use crate::values::Day;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };
    const EUR: PropertyType = PropertyType::Money {
        currency: Currency::Eur,
    };

    fn table(rows: &[(&str, &str)]) -> Table {
        Table {
            columns: vec![
                Column::new("Client", PropertyType::Text),
                Column::new("Montant", EUR),
            ],
            rows: rows
                .iter()
                .map(|(name, amount)| {
                    vec![
                        type_value(name, PropertyType::Text, CONTEXT),
                        type_value(amount, EUR, CONTEXT),
                    ]
                })
                .collect(),
        }
    }

    #[test]
    fn sums_money_exactly() {
        let cents: Vec<(&str, &str)> = (0..10).map(|_| ("x", "0,10 €")).collect();
        let total = view(&table(&cents), None).totals[1].clone();
        assert_eq!(
            total.map(|t| t.values),
            Some(vec![Typed::Money {
                minor: 100,
                currency: Currency::Eur
            }])
        );

        let mixed = view(
            &table(&[("a", "1 200,50 €"), ("b", "850"), ("c", "50 $")]),
            None,
        );
        assert_eq!(
            mixed.totals[1].as_ref().map(|t| t.display.as_str()),
            Some("2\u{202f}050,50\u{a0}€ + 50,00\u{a0}$")
        );
        assert_eq!(mixed.totals[0], None);
    }

    #[test]
    fn sorts_by_typed_value_with_blanks_last() {
        let t = table(&[
            ("Émile", "850 €"),
            ("anne", "1 200,50 €"),
            ("Bob", "?"),
            ("Zoé", "9 €"),
        ]);
        let ascending = view(
            &t,
            Some(Sort {
                column: 1,
                descending: false,
            }),
        )
        .order;
        assert_eq!(ascending, [3, 0, 1, 2]);
        let descending = view(
            &t,
            Some(Sort {
                column: 1,
                descending: true,
            }),
        )
        .order;
        assert_eq!(descending, [1, 0, 3, 2]);
        let by_name = view(
            &t,
            Some(Sort {
                column: 0,
                descending: false,
            }),
        )
        .order;
        assert_eq!(by_name, [1, 2, 0, 3]);
    }
}
