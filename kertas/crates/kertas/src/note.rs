use serde::Serialize;
use serde_json::Value as Json;

use crate::links::{Link, links};
use crate::model::Context;
use crate::prose::{from_markdown, to_markdown};

pub const SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoteRecord {
    pub version: u64,
    pub document: Json,
    pub markdown: String,
    pub links: Vec<Link>,
}

pub fn record(document: Json) -> NoteRecord {
    NoteRecord {
        version: SCHEMA_VERSION,
        markdown: to_markdown(&document),
        links: links(&document),
        document,
    }
}

type Migration = fn(Json) -> Json;

/// `MIGRATIONS[n]` turns a version `n + 1` document into a version `n + 2` one.
const MIGRATIONS: [Migration; SCHEMA_VERSION as usize - 1] = [];

pub fn open(stored: &Json, context: Context) -> Result<Json, String> {
    if let Some(markdown) = stored.as_str() {
        return Ok(from_markdown(markdown, context));
    }
    let version = stored
        .get("version")
        .and_then(Json::as_u64)
        .ok_or("a stored note has no version")?;
    let document = stored
        .get("document")
        .cloned()
        .ok_or("a stored note has no document")?;
    migrate(document, version, &MIGRATIONS)
}

fn migrate(document: Json, version: u64, migrations: &[Migration]) -> Result<Json, String> {
    let newest = migrations.len() as u64 + 1;
    if version == 0 {
        return Err("a stored note has version 0".into());
    }
    if version > newest {
        return Err(format!(
            "note schema {version} is newer than this engine's {newest}"
        ));
    }
    Ok(migrations[version as usize - 1..]
        .iter()
        .fold(document, |document, step| step(document)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lang::Lang;
    use crate::links::LinkKind;
    use crate::values::Day;
    use serde_json::json;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: Lang::Fr,
    };

    fn document() -> Json {
        json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "id": "b1" }, "content": [
                { "type": "text", "text": "Voir " },
                { "type": "pageRef", "attrs": { "page": "p-2", "title": "Hypothèses" } }
            ]}
        ]})
    }

    #[test]
    fn records_what_the_core_stores() {
        let note = record(document());
        assert_eq!(note.version, SCHEMA_VERSION);
        assert_eq!(note.markdown, "Voir [Hypothèses](kertas:page/p-2)");
        assert_eq!(
            note.links,
            vec![Link {
                kind: LinkKind::Page,
                target: "p-2".into()
            }]
        );
    }

    #[test]
    fn opens_a_stored_note_as_it_was() {
        let stored = serde_json::to_value(record(document())).unwrap_or_default();
        assert_eq!(open(&stored, CONTEXT), Ok(document()));
    }

    #[test]
    fn opens_a_note_still_in_markdown() {
        let opened = open(&json!("# Titre\n\nTexte."), CONTEXT).unwrap_or_default();
        assert_eq!(opened.pointer("/content/0/type"), Some(&json!("heading")));
    }

    #[test]
    fn refuses_a_note_from_a_newer_engine() {
        let stored = json!({ "version": SCHEMA_VERSION + 1, "document": document() });
        assert!(open(&stored, CONTEXT).is_err());
        assert!(open(&json!({ "document": document() }), CONTEXT).is_err());
        assert!(open(&json!({ "version": 0, "document": document() }), CONTEXT).is_err());
    }

    fn renamed_paragraphs(document: Json) -> Json {
        let text = document
            .to_string()
            .replace("\"paragraph\"", "\"text_block\"");
        serde_json::from_str(&text).unwrap_or(document)
    }

    fn marked(mut document: Json) -> Json {
        document["attrs"] = json!({ "migrated": true });
        document
    }

    #[test]
    fn brings_an_older_note_up_through_every_step() {
        let steps: [Migration; 2] = [renamed_paragraphs, marked];
        let from_one = migrate(document(), 1, &steps).unwrap_or_default();
        assert_eq!(
            from_one.pointer("/content/0/type"),
            Some(&json!("text_block"))
        );
        assert_eq!(from_one.pointer("/attrs/migrated"), Some(&json!(true)));

        let from_two = migrate(document(), 2, &steps).unwrap_or_default();
        assert_eq!(
            from_two.pointer("/content/0/type"),
            Some(&json!("paragraph"))
        );
        assert_eq!(from_two.pointer("/attrs/migrated"), Some(&json!(true)));

        assert_eq!(migrate(document(), 3, &steps), Ok(document()));
        assert!(migrate(document(), 4, &steps).is_err());
    }
}
