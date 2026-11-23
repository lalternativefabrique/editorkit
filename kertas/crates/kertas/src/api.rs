use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::block::{Block, classify};
use crate::chart::{Chart, chart};
use crate::document::{DocBlock, parse_document};
use crate::emphasis::{Emphasis, emphasize};
use crate::export::{Format, export, import_csv};
use crate::formula::compute as compute_formulas;
use crate::lang::{Lang, lang_of};
use crate::links::{Link, links};
use crate::model::{Context, PropertyType, Table, Value, infer_property, retype};
use crate::moment::{Moment, RecognizedDay, recognize_days, understand};
use crate::note::{NoteRecord, open, record};
use crate::prose::{from_markdown, to_markdown};
use crate::records::rows_for;
use crate::search::{Hit, Item, ItemRef, Topic};
use crate::spelling::{Misspelling, check, load, suggest};
use crate::stats::{Answer, Measure, answer, compute};
use crate::typography::{Edit, normalize};
use crate::view::{Sort, View, view};

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Classify {
        text: String,
        next: Option<String>,
        context: Context,
    },
    Normalize {
        text: String,
        #[serde(default)]
        lang: Lang,
    },
    Emphasize {
        text: String,
        context: Context,
    },
    Parse {
        text: String,
        context: Context,
    },
    LoadDictionary {
        #[serde(default)]
        lang: Lang,
        aff: String,
        dic: String,
    },
    Spell {
        text: String,
        #[serde(default)]
        lang: Lang,
    },
    Suggest {
        word: String,
        #[serde(default)]
        lang: Lang,
    },
    TypeValues {
        raws: Vec<String>,
        property: PropertyType,
        context: Context,
    },
    View {
        table: Table,
        sort: Option<Sort>,
    },
    Chart {
        table: Table,
        x: Option<usize>,
        y: Option<usize>,
        #[serde(default)]
        lang: Lang,
    },
    Understand {
        line: String,
        context: Context,
    },
    Export {
        table: Table,
        format: Format,
        #[serde(default)]
        lang: Lang,
    },
    Links {
        document: serde_json::Value,
    },
    ToMarkdown {
        document: serde_json::Value,
    },
    RecordNote {
        document: serde_json::Value,
    },
    OpenNote {
        stored: serde_json::Value,
        context: Context,
    },
    FromMarkdown {
        markdown: String,
        context: Context,
    },
    ImportCsv {
        text: String,
        context: Context,
    },
    Compute {
        table: Table,
        context: Context,
    },
    RecognizeDays {
        text: String,
        context: Context,
    },
    Infer {
        raws: Vec<String>,
        context: Context,
    },
    RowsFor {
        table: Table,
        text: String,
        context: Context,
    },
    Answer {
        table: Table,
        question: String,
    },
    Measure {
        table: Table,
        column: usize,
        measure: Measure,
        #[serde(default)]
        lang: Lang,
    },
    Index {
        items: Vec<Item>,
    },
    IndexChange {
        #[serde(default)]
        put: Vec<Item>,
        #[serde(default)]
        drop: Vec<ItemRef>,
    },
    Find {
        query: String,
        #[serde(default)]
        kinds: Vec<String>,
        limit: usize,
    },
    Topics {
        query: String,
        limit: usize,
    },
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum Response {
    Block(Block),
    Document(Vec<DocBlock>),
    Edits(Vec<Edit>),
    Loaded(bool),
    Misspellings(Vec<Misspelling>),
    Words(Vec<String>),
    Emphases(Vec<Emphasis>),
    Values(Vec<Value>),
    View(View),
    Chart(Option<Chart>),
    Property(PropertyType),
    Moment(Moment),
    Text(String),
    Links(Vec<Link>),
    Prose(serde_json::Value),
    Note(NoteRecord),
    Imported(Option<Table>),
    Table(Table),
    Days(Vec<RecognizedDay>),
    Rows(Option<Vec<Vec<Value>>>),
    Answer(Option<Answer>),
    Indexed(usize),
    Hits(Vec<Hit>),
    Topics(Vec<Topic>),
}

pub fn handle(request: Request) -> Result<Response, String> {
    Ok(match request {
        Request::Classify {
            text,
            next,
            context,
        } => Response::Block(classify(&text, next.as_deref(), context)),
        Request::Normalize { text, lang } => {
            Response::Edits(normalize(&text, lang_of(&text, lang)))
        }
        Request::Emphasize { text, context } => Response::Emphases(emphasize(&text, context)),
        Request::Parse { text, context } => Response::Document(parse_document(&text, context)),
        Request::TypeValues {
            raws,
            property,
            context,
        } => Response::Values(retype(&raws, property, context)),
        Request::View { table, sort } => Response::View(view(&table, sort)),
        Request::Chart { table, x, y, lang } => Response::Chart(chart(&table, x.zip(y), lang)),
        Request::Links { document } => Response::Links(links(&document)),
        Request::RecordNote { document } => Response::Note(record(document)),
        Request::OpenNote { stored, context } => Response::Prose(open(&stored, context)?),
        Request::ToMarkdown { document } => Response::Text(to_markdown(&document)),
        Request::FromMarkdown { markdown, context } => {
            Response::Prose(from_markdown(&markdown, context))
        }
        Request::Export {
            table,
            format,
            lang,
        } => Response::Text(export(&table, format, lang)),
        Request::ImportCsv { text, context } => Response::Imported(import_csv(&text, context)),
        Request::Compute { table, context } => Response::Table(compute_formulas(table, context)),
        Request::RecognizeDays { text, context } => {
            Response::Days(recognize_days(&text, context.today))
        }
        Request::Understand { line, context } => Response::Moment(understand(&line, context.today)),
        Request::Infer { raws, context } => Response::Property(infer_property(
            &raws.iter().map(String::as_str).collect::<Vec<_>>(),
            context,
        )),
        Request::RowsFor {
            table,
            text,
            context,
        } => Response::Rows(rows_for(&table, &text, context)),
        Request::Answer { table, question } => Response::Answer(answer(&table, &question)),
        Request::Measure {
            table,
            column,
            measure,
            lang,
        } => Response::Answer(compute(&table, column, measure, lang)),
        Request::LoadDictionary { lang, aff, dic } => Response::Loaded(load(lang, &aff, &dic)?),
        Request::Spell { text, lang } => Response::Misspellings(check(&text, lang)),
        Request::Suggest { word, lang } => Response::Words(suggest(&word, lang)),
        Request::Index { items } => Response::Indexed(crate::search::replace(items)?),
        Request::IndexChange { put, drop } => Response::Indexed(crate::search::change(put, &drop)?),
        Request::Find {
            query,
            kinds,
            limit,
        } => Response::Hits(crate::search::find(&query, &kinds, limit)?),
        Request::Topics { query, limit } => Response::Topics(crate::search::topics(&query, limit)?),
    })
}

pub fn handle_json(input: &[u8]) -> String {
    let outcome = serde_json::from_slice::<Request>(input)
        .map_err(|error| error.to_string())
        .and_then(handle)
        .and_then(|response| serde_json::to_value(response).map_err(|error| error.to_string()));
    match outcome {
        Ok(ok) => json!({ "ok": ok }).to_string(),
        Err(error) => json!({ "error": error.to_string() }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_json_with_ok_or_error() {
        let ok = handle_json(br#"{"op":"normalize","text":"Salut!"}"#);
        assert_eq!(
            ok,
            "{\"ok\":[{\"from\":5,\"insert\":\"\u{202f}\",\"to\":5}]}"
        );
        let error = handle_json(br#"{"op":"fly"}"#);
        assert!(
            error.starts_with(r#"{"error":"unknown variant `fly`"#),
            "{error}"
        );
        let typed = handle_json(
            br#"{"op":"type_values","raws":["12/03"],"property":{"type":"date"},"context":{"today":"2026-11-11"}}"#,
        );
        assert!(typed.contains(r#""iso":"2026-03-12""#), "{typed}");
    }

    #[test]
    fn keeps_an_index_between_calls() {
        let indexed = handle_json(
            br#"{"op":"index","items":[{"kind":"note","id":"n1","title":"Budget asso","text":"cotisations"},{"kind":"appointment","id":"a1","title":"Point budget","at":"2026-11-14T14:00:00Z"}]}"#,
        );
        assert_eq!(indexed, r#"{"ok":2}"#);
        let found = handle_json(br#"{"op":"find","query":"cotis","limit":5}"#);
        assert_eq!(
            found,
            r#"{"ok":[{"at":"","facts":[],"id":"n1","kind":"note","linked":[],"snippet":"cotisations","tags":[],"title":"Budget asso","url":""}]}"#
        );
        let changed = handle_json(
            br#"{"op":"index_change","drop":[{"kind":"note","id":"n1"}],"put":[{"kind":"reminder","id":"r1","title":"Payer la cotisation"}]}"#,
        );
        assert_eq!(changed, r#"{"ok":2}"#);
        let after = handle_json(br#"{"op":"find","query":"cotis","kinds":["reminder"],"limit":5}"#);
        assert!(after.contains(r#""id":"r1""#), "{after}");
        assert!(!after.contains(r#""id":"n1""#), "{after}");
    }
}
