use crate::lang::Lang;
use crate::model::{Column, Context, PropertyType, Table, Typed, Value, display_of};
use crate::values::{Currency, Day, Decimal};

const MAX_MAGNITUDE: f64 = 9.0e12;
const NUMBER_SCALE: u8 = 6;

#[derive(Debug, Clone, PartialEq)]
enum Val {
    Empty,
    Num(f64),
    Money(f64, Currency),
    Percent(f64),
    Date(Day),
    Bool(bool),
    Text(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, PartialEq)]
enum Expr {
    Lit(Val),
    Col(usize),
    Neg(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
    Call(Func, Vec<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Func {
    Round,
    Min,
    Max,
    Abs,
    If,
    Sum,
    Days,
    Today,
}

const FUNCTIONS: &[(&str, Func)] = &[
    ("arrondi", Func::Round),
    ("round", Func::Round),
    ("min", Func::Min),
    ("max", Func::Max),
    ("abs", Func::Abs),
    ("si", Func::If),
    ("if", Func::If),
    ("somme", Func::Sum),
    ("sum", Func::Sum),
    ("jours", Func::Days),
    ("days", Func::Days),
    ("aujourdhui", Func::Today),
    ("today", Func::Today),
];

#[derive(Debug, Clone, PartialEq)]
enum Problem {
    Syntax,
    UnknownColumn(String),
    UnknownFunction(String),
    Arguments(&'static str),
    Types,
    DivisionByZero,
    Currencies,
    TooLarge,
    Cycle,
}

impl Problem {
    fn message(&self, lang: Lang) -> String {
        match (self, lang) {
            (Problem::Syntax, Lang::Fr) => "formule incomplète ou mal écrite".into(),
            (Problem::Syntax, Lang::En) => "incomplete or malformed formula".into(),
            (Problem::UnknownColumn(name), Lang::Fr) => format!("aucune colonne « {name} »"),
            (Problem::UnknownColumn(name), Lang::En) => format!("no column \"{name}\""),
            (Problem::UnknownFunction(name), Lang::Fr) => format!("fonction inconnue « {name} »"),
            (Problem::UnknownFunction(name), Lang::En) => format!("unknown function \"{name}\""),
            (Problem::Arguments(name), Lang::Fr) => {
                format!("mauvais nombre d'arguments pour {name}")
            }
            (Problem::Arguments(name), Lang::En) => format!("wrong number of arguments for {name}"),
            (Problem::Types, Lang::Fr) => "types incompatibles".into(),
            (Problem::Types, Lang::En) => "incompatible types".into(),
            (Problem::DivisionByZero, Lang::Fr) => "division par zéro".into(),
            (Problem::DivisionByZero, Lang::En) => "division by zero".into(),
            (Problem::Currencies, Lang::Fr) => "devises différentes".into(),
            (Problem::Currencies, Lang::En) => "different currencies".into(),
            (Problem::TooLarge, Lang::Fr) => "nombre trop grand".into(),
            (Problem::TooLarge, Lang::En) => "number too large".into(),
            (Problem::Cycle, Lang::Fr) => "la formule dépend d'elle-même".into(),
            (Problem::Cycle, Lang::En) => "the formula depends on itself".into(),
        }
    }
}

fn fold(c: char) -> char {
    let lower = c.to_lowercase().next().unwrap_or(c);
    match lower {
        'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'î' | 'ï' | 'í' => 'i',
        'ô' | 'ö' | 'ó' => 'o',
        'ù' | 'û' | 'ü' | 'ú' => 'u',
        'ç' => 'c',
        'œ' => 'o',
        '\u{2019}' => '\'',
        other => other,
    }
}

fn folded(text: &str) -> Vec<char> {
    text.trim().chars().map(fold).collect()
}

struct Parser<'a> {
    chars: Vec<char>,
    folded: Vec<char>,
    at: usize,
    columns: &'a [Vec<char>],
}

impl Parser<'_> {
    fn skip_spaces(&mut self) {
        while self.chars.get(self.at).is_some_and(|c| c.is_whitespace()) {
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<char> {
        self.skip_spaces();
        self.chars.get(self.at).copied()
    }

    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn is_word(c: char) -> bool {
        c.is_alphanumeric() || c == '_'
    }

    fn column_here(&self) -> Option<(usize, usize)> {
        self.columns
            .iter()
            .enumerate()
            .filter(|(_, name)| !name.is_empty())
            .filter(|(_, name)| self.folded[self.at..].starts_with(name))
            .filter(|(_, name)| {
                self.folded
                    .get(self.at + name.len())
                    .is_none_or(|c| !Self::is_word(*c))
            })
            .max_by_key(|(_, name)| name.len())
            .map(|(index, name)| (index, name.len()))
    }

    fn expr(&mut self) -> Result<Expr, Problem> {
        let left = self.sum()?;
        self.skip_spaces();
        let op = match (self.chars.get(self.at), self.chars.get(self.at + 1)) {
            (Some('<'), Some('=')) => Some((Op::Le, 2)),
            (Some('>'), Some('=')) => Some((Op::Ge, 2)),
            (Some('<'), Some('>')) | (Some('!'), Some('=')) => Some((Op::Ne, 2)),
            (Some('<'), _) => Some((Op::Lt, 1)),
            (Some('>'), _) => Some((Op::Gt, 1)),
            (Some('='), _) => Some((Op::Eq, 1)),
            _ => None,
        };
        let Some((op, width)) = op else {
            return Ok(left);
        };
        self.at += width;
        Ok(Expr::Bin(op, Box::new(left), Box::new(self.sum()?)))
    }

    fn sum(&mut self) -> Result<Expr, Problem> {
        let mut left = self.product()?;
        loop {
            let op = match self.peek() {
                Some('+') => Op::Add,
                Some('-') | Some('−') => Op::Sub,
                _ => return Ok(left),
            };
            self.at += 1;
            left = Expr::Bin(op, Box::new(left), Box::new(self.product()?));
        }
    }

    fn product(&mut self) -> Result<Expr, Problem> {
        let mut left = self.unary()?;
        loop {
            let op = match self.peek() {
                Some('*') | Some('×') => Op::Mul,
                Some('/') | Some('÷') => Op::Div,
                _ => return Ok(left),
            };
            self.at += 1;
            left = Expr::Bin(op, Box::new(left), Box::new(self.unary()?));
        }
    }

    fn unary(&mut self) -> Result<Expr, Problem> {
        if self.eat('-') || self.eat('−') {
            return Ok(Expr::Neg(Box::new(self.unary()?)));
        }
        self.primary()
    }

    fn number(&mut self) -> Result<Expr, Problem> {
        let mut text = String::new();
        while let Some(&c) = self.chars.get(self.at) {
            let decimal_mark = (c == ',' || c == '.')
                && self
                    .chars
                    .get(self.at + 1)
                    .is_some_and(char::is_ascii_digit)
                && !text.contains('.');
            if c.is_ascii_digit() {
                text.push(c);
            } else if decimal_mark {
                text.push('.');
            } else if c == ' ' || c == '\u{a0}' || c == '\u{202f}' {
                let next_digit = self
                    .chars
                    .get(self.at + 1)
                    .is_some_and(char::is_ascii_digit);
                let grouped = next_digit
                    && self.chars[self.at + 1..]
                        .iter()
                        .take_while(|c| c.is_ascii_digit())
                        .count()
                        == 3;
                if !grouped {
                    break;
                }
            } else {
                break;
            }
            self.at += 1;
        }
        let value: f64 = text.parse().map_err(|_| Problem::Syntax)?;
        if self.eat('%') {
            return Ok(Expr::Lit(Val::Percent(value / 100.0)));
        }
        Ok(Expr::Lit(Val::Num(value)))
    }

    fn arguments(&mut self) -> Result<Vec<Expr>, Problem> {
        let mut args = Vec::new();
        if self.eat(')') {
            return Ok(args);
        }
        loop {
            args.push(self.expr()?);
            if self.eat(')') {
                return Ok(args);
            }
            if !(self.eat(';') || self.eat(',')) {
                return Err(Problem::Syntax);
            }
        }
    }

    fn primary(&mut self) -> Result<Expr, Problem> {
        match self.peek() {
            None => Err(Problem::Syntax),
            Some('(') => {
                self.at += 1;
                let inner = self.expr()?;
                if self.eat(')') {
                    Ok(inner)
                } else {
                    Err(Problem::Syntax)
                }
            }
            Some('[') => {
                self.at += 1;
                let start = self.at;
                while self.chars.get(self.at).is_some_and(|c| *c != ']') {
                    self.at += 1;
                }
                let name: String = self.chars[start..self.at].iter().collect();
                if !self.eat(']') {
                    return Err(Problem::Syntax);
                }
                let wanted = folded(&name);
                self.columns
                    .iter()
                    .position(|column| *column == wanted)
                    .map(Expr::Col)
                    .ok_or(Problem::UnknownColumn(name.trim().to_string()))
            }
            Some(c) if c.is_ascii_digit() => self.number(),
            Some(c) if Self::is_word(c) => {
                if let Some((index, width)) = self.column_here() {
                    let call = self.folded[self.at + width..]
                        .iter()
                        .find(|c| !c.is_whitespace())
                        == Some(&'(');
                    if !call {
                        self.at += width;
                        return Ok(Expr::Col(index));
                    }
                }
                let start = self.at;
                while self
                    .chars
                    .get(self.at)
                    .is_some_and(|c| Self::is_word(*c) || *c == '\'')
                {
                    self.at += 1;
                }
                let word: String = self.chars[start..self.at].iter().collect();
                let key: String = self.folded[start..self.at]
                    .iter()
                    .filter(|c| **c != '\'')
                    .collect();
                if !self.eat('(') {
                    return Err(Problem::UnknownColumn(word));
                }
                let func = FUNCTIONS
                    .iter()
                    .find(|(name, _)| *name == key)
                    .map(|(_, func)| *func)
                    .ok_or(Problem::UnknownFunction(word))?;
                Ok(Expr::Call(func, self.arguments()?))
            }
            Some(_) => Err(Problem::Syntax),
        }
    }
}

fn parse(formula: &str, columns: &[Vec<char>]) -> Result<Expr, Problem> {
    let source = formula.trim().trim_start_matches('=');
    if source.trim().is_empty() {
        return Ok(Expr::Lit(Val::Empty));
    }
    let mut parser = Parser {
        chars: source.chars().collect(),
        folded: source.chars().map(fold).collect(),
        at: 0,
        columns,
    };
    let expr = parser.expr()?;
    if parser.peek().is_some() {
        return Err(Problem::Syntax);
    }
    Ok(expr)
}

fn references(expr: &Expr, out: &mut Vec<usize>) {
    match expr {
        Expr::Lit(_) => {}
        Expr::Col(index) => out.push(*index),
        Expr::Neg(inner) => references(inner, out),
        Expr::Bin(_, left, right) => {
            references(left, out);
            references(right, out);
        }
        Expr::Call(_, args) => args.iter().for_each(|arg| references(arg, out)),
    }
}

fn decimal_f64(value: Decimal) -> f64 {
    value.units as f64 / 10f64.powi(i32::from(value.scale))
}

fn cell(value: &Value) -> Val {
    match &value.typed {
        Some(Typed::Number(n)) => Val::Num(decimal_f64(*n)),
        Some(Typed::Money { minor, currency }) => Val::Money(*minor as f64 / 100.0, *currency),
        Some(Typed::Percent(p)) => Val::Percent(decimal_f64(*p) / 100.0),
        Some(Typed::Date { iso }) => Day::parse_iso(iso).map_or(Val::Empty, Val::Date),
        Some(Typed::Checkbox { checked }) => Val::Bool(*checked),
        None if value.raw.trim().is_empty() => Val::Empty,
        None => Val::Text(value.raw.clone()),
    }
}

fn scalar(value: &Val) -> Option<f64> {
    match value {
        Val::Num(n) | Val::Percent(n) | Val::Money(n, _) => Some(*n),
        _ => None,
    }
}

fn zero_like(other: &Val) -> Val {
    match other {
        Val::Money(_, currency) => Val::Money(0.0, *currency),
        Val::Percent(_) => Val::Percent(0.0),
        _ => Val::Num(0.0),
    }
}

fn add(left: Val, right: Val, sign: f64) -> Result<Val, Problem> {
    let (left, right) = match (left, right) {
        (Val::Empty, Val::Empty) => return Ok(Val::Empty),
        (Val::Empty, right) => (zero_like(&right), right),
        (left, Val::Empty) => {
            let zero = zero_like(&left);
            (left, zero)
        }
        pair => pair,
    };
    Ok(match (left, right) {
        (Val::Num(a), Val::Num(b)) => Val::Num(a + sign * b),
        (Val::Money(a, x), Val::Money(b, y)) if x == y => Val::Money(a + sign * b, x),
        (Val::Money(..), Val::Money(..)) => return Err(Problem::Currencies),
        (Val::Money(a, x), Val::Num(b)) => Val::Money(a + sign * b, x),
        (Val::Num(a), Val::Money(b, y)) => Val::Money(a + sign * b, y),
        (Val::Percent(a), Val::Percent(b)) => Val::Percent(a + sign * b),
        (Val::Num(a), Val::Percent(b)) | (Val::Percent(a), Val::Num(b)) => Val::Num(a + sign * b),
        (Val::Date(day), Val::Num(days)) => day
            .plus_days((sign * days).round() as i64)
            .map(Val::Date)
            .ok_or(Problem::TooLarge)?,
        (Val::Num(days), Val::Date(day)) if sign > 0.0 => day
            .plus_days(days.round() as i64)
            .map(Val::Date)
            .ok_or(Problem::TooLarge)?,
        (Val::Date(a), Val::Date(b)) if sign < 0.0 => Val::Num(days_between(a, b) as f64),
        _ => return Err(Problem::Types),
    })
}

fn days_between(later: Day, earlier: Day) -> i64 {
    later.days_since_epoch() - earlier.days_since_epoch()
}

fn multiply(left: Val, right: Val) -> Result<Val, Problem> {
    Ok(match (left, right) {
        (Val::Empty, _) | (_, Val::Empty) => Val::Empty,
        (Val::Num(a), Val::Num(b)) => Val::Num(a * b),
        (Val::Money(a, c), Val::Num(b) | Val::Percent(b))
        | (Val::Num(b) | Val::Percent(b), Val::Money(a, c)) => Val::Money(a * b, c),
        (Val::Percent(a), Val::Percent(b)) => Val::Percent(a * b),
        (Val::Num(a), Val::Percent(b)) | (Val::Percent(b), Val::Num(a)) => Val::Num(a * b),
        _ => return Err(Problem::Types),
    })
}

fn divide(left: Val, right: Val) -> Result<Val, Problem> {
    if matches!(left, Val::Empty) || matches!(right, Val::Empty) {
        return Ok(Val::Empty);
    }
    if scalar(&right) == Some(0.0) {
        return Err(Problem::DivisionByZero);
    }
    Ok(match (left, right) {
        (Val::Num(a), Val::Num(b) | Val::Percent(b)) => Val::Num(a / b),
        (Val::Money(a, c), Val::Num(b) | Val::Percent(b)) => Val::Money(a / b, c),
        (Val::Money(a, x), Val::Money(b, y)) if x == y => Val::Num(a / b),
        (Val::Money(..), Val::Money(..)) => return Err(Problem::Currencies),
        (Val::Percent(a), Val::Num(b)) => Val::Percent(a / b),
        (Val::Percent(a), Val::Percent(b)) => Val::Num(a / b),
        _ => return Err(Problem::Types),
    })
}

fn compare(op: Op, left: Val, right: Val) -> Result<Val, Problem> {
    use std::cmp::Ordering;
    let order = match (&left, &right) {
        (Val::Empty, _) | (_, Val::Empty) => return Ok(Val::Empty),
        (Val::Date(a), Val::Date(b)) => a.cmp(b),
        (Val::Text(a), Val::Text(b)) => {
            let (a, b) = (folded(a), folded(b));
            a.cmp(&b)
        }
        (Val::Bool(a), Val::Bool(b)) => a.cmp(b),
        (Val::Money(_, x), Val::Money(_, y)) if x != y => return Err(Problem::Currencies),
        _ => match (scalar(&left), scalar(&right)) {
            (Some(a), Some(b)) => a.partial_cmp(&b).unwrap_or(Ordering::Equal),
            _ => return Err(Problem::Types),
        },
    };
    Ok(Val::Bool(match op {
        Op::Eq => order == Ordering::Equal,
        Op::Ne => order != Ordering::Equal,
        Op::Lt => order == Ordering::Less,
        Op::Le => order != Ordering::Greater,
        Op::Gt => order == Ordering::Greater,
        Op::Ge => order != Ordering::Less,
        _ => return Err(Problem::Syntax),
    }))
}

fn rounded(value: Val, places: i32) -> Result<Val, Problem> {
    let factor = 10f64.powi(places);
    let round = |n: f64| (n * factor).round() / factor;
    Ok(match value {
        Val::Num(n) => Val::Num(round(n)),
        Val::Money(n, c) => Val::Money(round(n), c),
        Val::Percent(n) => Val::Percent((n * 100.0 * factor).round() / factor / 100.0),
        Val::Empty => Val::Empty,
        _ => return Err(Problem::Types),
    })
}

fn extreme(values: Vec<Val>, keep: std::cmp::Ordering) -> Result<Val, Problem> {
    let mut best = Val::Empty;
    for value in values {
        if matches!(value, Val::Empty) {
            continue;
        }
        if matches!(best, Val::Empty) {
            best = value;
            continue;
        }
        if let Val::Bool(true) = compare(
            if keep == std::cmp::Ordering::Greater {
                Op::Gt
            } else {
                Op::Lt
            },
            value.clone(),
            best.clone(),
        )? {
            best = value;
        }
    }
    Ok(best)
}

fn call(func: Func, args: Vec<Val>, today: Day) -> Result<Val, Problem> {
    let arity = |name: &'static str, ok: bool| {
        if ok {
            Ok(())
        } else {
            Err(Problem::Arguments(name))
        }
    };
    match func {
        Func::Round => {
            arity("arrondi", (1..=2).contains(&args.len()))?;
            let places = match args.get(1) {
                Some(Val::Num(n)) => n.round() as i32,
                Some(_) => return Err(Problem::Types),
                None => 0,
            };
            let mut args = args;
            rounded(args.swap_remove(0), places)
        }
        Func::Min => extreme(args, std::cmp::Ordering::Less),
        Func::Max => extreme(args, std::cmp::Ordering::Greater),
        Func::Abs => {
            arity("abs", args.len() == 1)?;
            Ok(match &args[0] {
                Val::Num(n) => Val::Num(n.abs()),
                Val::Money(n, c) => Val::Money(n.abs(), *c),
                Val::Percent(n) => Val::Percent(n.abs()),
                Val::Empty => Val::Empty,
                _ => return Err(Problem::Types),
            })
        }
        Func::If => {
            arity("si", (2..=3).contains(&args.len()))?;
            let mut args = args.into_iter();
            let condition = args.next().unwrap_or(Val::Empty);
            let then = args.next().unwrap_or(Val::Empty);
            let otherwise = args.next().unwrap_or(Val::Empty);
            Ok(match condition {
                Val::Bool(true) => then,
                Val::Bool(false) | Val::Empty => otherwise,
                Val::Num(n) | Val::Percent(n) | Val::Money(n, _) => {
                    if n != 0.0 {
                        then
                    } else {
                        otherwise
                    }
                }
                _ => return Err(Problem::Types),
            })
        }
        Func::Sum => args
            .into_iter()
            .try_fold(Val::Empty, |total, value| add(total, value, 1.0)),
        Func::Days => {
            arity("jours", args.len() == 2)?;
            match (&args[0], &args[1]) {
                (Val::Date(a), Val::Date(b)) => Ok(Val::Num(days_between(*a, *b) as f64)),
                (Val::Empty, _) | (_, Val::Empty) => Ok(Val::Empty),
                _ => Err(Problem::Types),
            }
        }
        Func::Today => {
            arity("aujourdhui", args.is_empty())?;
            Ok(Val::Date(today))
        }
    }
}

fn eval(expr: &Expr, row: &[Val], today: Day) -> Result<Val, Problem> {
    let value = match expr {
        Expr::Lit(value) => value.clone(),
        Expr::Col(index) => row.get(*index).cloned().unwrap_or(Val::Empty),
        Expr::Neg(inner) => multiply(eval(inner, row, today)?, Val::Num(-1.0))?,
        Expr::Bin(op, left, right) => {
            let (left, right) = (eval(left, row, today)?, eval(right, row, today)?);
            match op {
                Op::Add => add(left, right, 1.0)?,
                Op::Sub => add(left, right, -1.0)?,
                Op::Mul => multiply(left, right)?,
                Op::Div => divide(left, right)?,
                _ => compare(*op, left, right)?,
            }
        }
        Expr::Call(func, args) => {
            let args = args
                .iter()
                .map(|arg| eval(arg, row, today))
                .collect::<Result<Vec<_>, _>>()?;
            call(*func, args, today)?
        }
    };
    match scalar(&value) {
        Some(n) if !n.is_finite() || n.abs() > MAX_MAGNITUDE => Err(Problem::TooLarge),
        _ => Ok(value),
    }
}

fn decimal(value: f64, scale: u8) -> Decimal {
    let mut units = (value * 10f64.powi(i32::from(scale))).round() as i64;
    let mut scale = scale;
    while scale > 0 && units % 10 == 0 {
        units /= 10;
        scale -= 1;
    }
    Decimal { units, scale }
}

fn typed(value: &Val) -> Option<Typed> {
    match value {
        Val::Num(n) => Some(Typed::Number(decimal(*n, NUMBER_SCALE))),
        Val::Money(n, currency) => Some(Typed::Money {
            minor: (n * 100.0).round() as i64,
            currency: *currency,
        }),
        Val::Percent(n) => Some(Typed::Percent(decimal(n * 100.0, 2))),
        Val::Date(day) => Some(Typed::Date {
            iso: day.to_string(),
        }),
        Val::Bool(checked) => Some(Typed::Checkbox { checked: *checked }),
        Val::Empty | Val::Text(_) => None,
    }
}

fn property_of(value: &Val) -> Option<PropertyType> {
    Some(match value {
        Val::Num(_) => PropertyType::Number,
        Val::Money(_, currency) => PropertyType::Money {
            currency: *currency,
        },
        Val::Percent(_) => PropertyType::Percent,
        Val::Date(_) => PropertyType::Date,
        Val::Bool(_) => PropertyType::Checkbox,
        Val::Text(_) => PropertyType::Text,
        Val::Empty => return None,
    })
}

fn result_value(result: &Result<Val, Problem>) -> Value {
    match result {
        Ok(value) => {
            let typed = typed(value);
            let display = match (&typed, value) {
                (Some(typed), _) => display_of(typed),
                (None, Val::Text(text)) => text.clone(),
                _ => String::new(),
            };
            Value {
                raw: display.clone(),
                typed,
                display,
            }
        }
        Err(_) => Value {
            raw: String::new(),
            typed: None,
            display: "#".into(),
        },
    }
}

/// Fills every formula column from the other columns of each row, formulas
/// that use other formulas after them, and records why a formula cannot run.
pub fn compute(mut table: Table, context: Context) -> Table {
    let names: Vec<Vec<char>> = table.columns.iter().map(|c| folded(&c.name)).collect();
    let parsed: Vec<Option<Result<Expr, Problem>>> = table
        .columns
        .iter()
        .map(|column| column.formula.as_ref().map(|f| parse(f, &names)))
        .collect();
    let order = evaluation_order(&parsed);
    let width = table.columns.len();
    let mut grid: Vec<Vec<Val>> = table
        .rows
        .iter()
        .map(|row| {
            (0..width)
                .map(|c| row.get(c).map_or(Val::Empty, cell))
                .collect()
        })
        .collect();
    for (index, problem) in &order {
        let column: &mut Column = &mut table.columns[*index];
        let expr = match (problem, &parsed[*index]) {
            (Some(problem), _) => Err(problem.clone()),
            (None, Some(Ok(expr))) => Ok(expr),
            (None, Some(Err(problem))) => Err(problem.clone()),
            (None, None) => continue,
        };
        let expr = match expr {
            Ok(expr) => expr,
            Err(problem) => {
                column.formula_error = Some(problem.message(context.lang));
                for (r, row) in table.rows.iter_mut().enumerate() {
                    set(row, *index, result_value(&Err(problem.clone())), width);
                    grid[r][*index] = Val::Empty;
                }
                continue;
            }
        };
        let mut first_error = None;
        let mut property = None;
        for (r, row) in table.rows.iter_mut().enumerate() {
            let result = eval(expr, &grid[r], context.today);
            if let Err(problem) = &result {
                first_error.get_or_insert_with(|| problem.message(context.lang));
            }
            if let Ok(value) = &result {
                property = property.or_else(|| property_of(value));
            }
            set(row, *index, result_value(&result), width);
            grid[r][*index] = result.unwrap_or(Val::Empty);
        }
        column.formula_error = first_error;
        if let Some(property) = property {
            column.property = property;
        }
    }
    table
}

fn set(row: &mut Vec<Value>, index: usize, value: Value, width: usize) {
    while row.len() < width {
        row.push(Value {
            raw: String::new(),
            typed: None,
            display: String::new(),
        });
    }
    row[index] = value;
}

fn evaluation_order(parsed: &[Option<Result<Expr, Problem>>]) -> Vec<(usize, Option<Problem>)> {
    let depends: Vec<Vec<usize>> = parsed
        .iter()
        .map(|formula| match formula {
            Some(Ok(expr)) => {
                let mut out = Vec::new();
                references(expr, &mut out);
                out.retain(|i| parsed.get(*i).is_some_and(Option::is_some));
                out
            }
            _ => Vec::new(),
        })
        .collect();
    let mut order = Vec::new();
    let mut done = vec![false; parsed.len()];
    let mut progress = true;
    while progress {
        progress = false;
        for index in 0..parsed.len() {
            if done[index] || parsed[index].is_none() {
                continue;
            }
            if depends[index].iter().all(|d| done[*d] && *d != index) {
                done[index] = true;
                order.push((index, None));
                progress = true;
            }
        }
    }
    for index in 0..parsed.len() {
        if !done[index] && parsed[index].is_some() {
            order.push((index, Some(Problem::Cycle)));
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::type_value;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 12,
        },
        lang: Lang::Fr,
    };

    const EUR: PropertyType = PropertyType::Money {
        currency: Currency::Eur,
    };

    fn table(columns: Vec<(&str, PropertyType, Option<&str>)>, rows: Vec<Vec<&str>>) -> Table {
        let columns: Vec<Column> = columns
            .into_iter()
            .map(|(name, property, formula)| Column {
                formula: formula.map(str::to_string),
                ..Column::new(name, property)
            })
            .collect();
        let rows = rows
            .into_iter()
            .map(|row| {
                row.iter()
                    .zip(&columns)
                    .map(|(raw, column)| type_value(raw, column.property, CONTEXT))
                    .collect()
            })
            .collect();
        Table { columns, rows }
    }

    fn shown(table: &Table, column: usize) -> Vec<String> {
        table
            .rows
            .iter()
            .map(|row| row[column].display.clone())
            .collect()
    }

    #[test]
    fn multiplies_a_price_by_a_quantity_into_an_amount() {
        let computed = compute(
            table(
                vec![
                    ("Prix unitaire", EUR, None),
                    ("Quantité", PropertyType::Number, None),
                    (
                        "Total",
                        PropertyType::Text,
                        Some("Prix unitaire * quantite"),
                    ),
                ],
                vec![vec!["12,50 €", "4", ""], vec!["3 €", "", ""]],
            ),
            CONTEXT,
        );
        assert_eq!(computed.columns[2].property, EUR);
        assert_eq!(computed.columns[2].formula_error, None);
        assert_eq!(shown(&computed, 2), vec!["50,00\u{a0}€", ""]);
    }

    #[test]
    fn applies_a_rate_and_rounds() {
        let computed = compute(
            table(
                vec![
                    ("Montant", EUR, None),
                    (
                        "TTC",
                        PropertyType::Text,
                        Some("arrondi(Montant * (1 + 20 %); 0)"),
                    ),
                    ("Marge", PropertyType::Text, Some("[TTC] - Montant")),
                ],
                vec![vec!["99,90 €", "", ""]],
            ),
            CONTEXT,
        );
        assert_eq!(shown(&computed, 1), vec!["120,00\u{a0}€"]);
        assert_eq!(shown(&computed, 2), vec!["20,10\u{a0}€"]);
    }

    #[test]
    fn counts_days_and_moves_dates() {
        let computed = compute(
            table(
                vec![
                    ("Début", PropertyType::Date, None),
                    ("Fin", PropertyType::Date, None),
                    ("Durée", PropertyType::Text, Some("Fin - Début")),
                    ("Relance", PropertyType::Text, Some("Fin + 7")),
                    ("En retard", PropertyType::Text, Some("Fin < aujourdhui()")),
                ],
                vec![vec!["01/11/2026", "10/11/2026", "", "", ""]],
            ),
            CONTEXT,
        );
        assert_eq!(shown(&computed, 2), vec!["9"]);
        assert_eq!(shown(&computed, 3), vec!["17/11/2026"]);
        assert_eq!(computed.columns[4].property, PropertyType::Checkbox);
        assert_eq!(
            computed.rows[0][4].typed,
            Some(Typed::Checkbox { checked: true })
        );
    }

    #[test]
    fn chooses_with_si_and_sums_a_row() {
        let computed = compute(
            table(
                vec![
                    ("A", PropertyType::Number, None),
                    ("B", PropertyType::Number, None),
                    (
                        "Statut",
                        PropertyType::Text,
                        Some("si(somme(A; B) >= 10; 1; 0)"),
                    ),
                    ("Plus grand", PropertyType::Text, Some("max(A, B)")),
                ],
                vec![vec!["4", "7,5", "", ""], vec!["1", "", "", ""]],
            ),
            CONTEXT,
        );
        assert_eq!(shown(&computed, 2), vec!["1", "0"]);
        assert_eq!(shown(&computed, 3), vec!["7,5", "1"]);
    }

    #[test]
    fn explains_what_cannot_be_computed() {
        let computed = compute(
            table(
                vec![
                    ("Montant", EUR, None),
                    ("Zéro", PropertyType::Number, None),
                    ("Inconnue", PropertyType::Text, Some("Prix * 2")),
                    ("Division", PropertyType::Text, Some("Montant / Zéro")),
                    ("Boucle A", PropertyType::Text, Some("[Boucle B] + 1")),
                    ("Boucle B", PropertyType::Text, Some("[Boucle A] + 1")),
                    ("Cassée", PropertyType::Text, Some("Montant * (2")),
                ],
                vec![vec!["10 €", "0", "", "", "", "", ""]],
            ),
            CONTEXT,
        );
        let errors: Vec<Option<String>> = computed.columns[2..]
            .iter()
            .map(|c| c.formula_error.clone())
            .collect();
        assert_eq!(
            errors,
            vec![
                Some("aucune colonne « Prix »".into()),
                Some("division par zéro".into()),
                Some("la formule dépend d'elle-même".into()),
                Some("la formule dépend d'elle-même".into()),
                Some("formule incomplète ou mal écrite".into()),
            ]
        );
        assert_eq!(computed.rows[0][3].display, "#");
    }

    #[test]
    fn a_formula_not_written_yet_leaves_its_cells_empty() {
        let computed = compute(
            table(
                vec![
                    ("A", PropertyType::Number, None),
                    ("B", PropertyType::Text, Some(" ")),
                ],
                vec![vec!["4", "ancien"]],
            ),
            CONTEXT,
        );
        assert_eq!(computed.columns[1].formula_error, None);
        assert_eq!(shown(&computed, 1), vec![""]);
    }

    #[test]
    fn a_formula_can_use_another_formula_written_after_it() {
        let computed = compute(
            table(
                vec![
                    ("HT", EUR, None),
                    ("TTC", PropertyType::Text, Some("TVA + HT")),
                    ("TVA", PropertyType::Text, Some("HT * 20%")),
                ],
                vec![vec!["100 €", "", ""]],
            ),
            CONTEXT,
        );
        assert_eq!(shown(&computed, 1), vec!["120,00\u{a0}€"]);
    }
}
