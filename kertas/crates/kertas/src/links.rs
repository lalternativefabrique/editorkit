use serde::Serialize;
use serde_json::Value as Json;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Page,
    Table,
    Event,
    Board,
    Resource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Link {
    pub kind: LinkKind,
    pub target: String,
}

const PAGE_REFERENCE: &str = "pageRef";
const LIVE_ANSWER: &str = "kertasMeasure";
const PDF: &str = "pdf";
const RESOURCE: &str = "resource:";
pub const EVENT_LINK: &str = "kertas:event/";
pub const BOARD_LINK: &str = "kertas:board/";

fn percent_decoded(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push((high * 16 + low) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn linked(node: &Json, prefix: &str) -> Option<String> {
    node.get("marks")?
        .as_array()?
        .iter()
        .filter(|mark| mark.get("type").and_then(Json::as_str) == Some("link"))
        .find_map(|mark| {
            mark.get("attrs")?
                .get("href")?
                .as_str()?
                .strip_prefix(prefix)
        })
        .map(|rest| percent_decoded(rest.split(['?', '#']).next().unwrap_or_default()))
        .filter(|target| !target.is_empty())
}

fn target_of(node: &Json, attribute: &str) -> Option<String> {
    node.get("attrs")?
        .get(attribute)?
        .as_str()
        .filter(|target| !target.is_empty())
        .map(str::to_string)
}

fn collect(node: &Json, out: &mut Vec<Link>) {
    let found = match node.get("type").and_then(Json::as_str) {
        Some(PAGE_REFERENCE) => target_of(node, "page").map(|target| Link {
            kind: LinkKind::Page,
            target,
        }),
        Some(LIVE_ANSWER) => target_of(node, "table").map(|target| Link {
            kind: LinkKind::Table,
            target,
        }),
        Some(PDF) => target_of(node, "src")
            .and_then(|src| src.strip_prefix(RESOURCE).map(str::to_string))
            .filter(|id| !id.is_empty())
            .map(|target| Link {
                kind: LinkKind::Resource,
                target,
            }),
        Some("text") => linked(node, EVENT_LINK)
            .map(|target| Link {
                kind: LinkKind::Event,
                target,
            })
            .or_else(|| {
                linked(node, BOARD_LINK).map(|target| Link {
                    kind: LinkKind::Board,
                    target,
                })
            }),
        _ => None,
    };
    if let Some(link) = found
        && !out.contains(&link)
    {
        out.push(link);
    }
    for child in node
        .get("content")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
    {
        collect(child, out);
    }
}

pub fn links(document: &Json) -> Vec<Link> {
    let mut out = Vec::new();
    collect(document, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_a_kept_pdf_once_and_ignores_one_kept_in_the_note() {
        let document = json!({ "type": "doc", "content": [
            { "type": "pdf", "attrs": { "src": "resource:r-1", "name": "a.pdf" } },
            { "type": "pdf", "attrs": { "src": "resource:r-1", "name": "a.pdf" } },
            { "type": "pdf", "attrs": { "src": "data:application/pdf;base64,AA", "name": "b.pdf" } },
            { "type": "pdf", "attrs": { "src": "resource:", "name": "c.pdf" } }
        ]});
        assert_eq!(
            links(&document),
            vec![Link {
                kind: LinkKind::Resource,
                target: "r-1".into()
            }]
        );
    }

    #[test]
    fn finds_cited_pages_and_tables_once_each() {
        let document = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "voir " },
                    { "type": "pageRef", "attrs": { "page": "p-2", "title": "Hypothèses" } },
                    { "type": "pageRef", "attrs": { "page": "p-2", "title": "Hypothèses" } }
                ]},
                { "type": "bulletList", "content": [ { "type": "listItem", "content": [
                    { "type": "paragraph", "content": [
                        { "type": "pageRef", "attrs": { "page": "p-3" } }
                    ]}
                ]}]},
                { "type": "paragraph", "content": [
                    { "type": "kertasMeasure", "attrs": { "table": "t-1", "text": "Total" } }
                ]}
            ]
        });
        assert_eq!(
            links(&document),
            vec![
                Link {
                    kind: LinkKind::Page,
                    target: "p-2".into()
                },
                Link {
                    kind: LinkKind::Page,
                    target: "p-3".into()
                },
                Link {
                    kind: LinkKind::Table,
                    target: "t-1".into()
                },
            ]
        );
    }

    #[test]
    fn finds_a_cited_meeting_once_from_its_link() {
        let event = |text: &str, href: &str| json!({ "type": "text", "text": text, "marks": [{ "type": "bold" }, { "type": "link", "attrs": { "href": href } }] });
        let document = json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                event("Réunion Marc", "kertas:event/e-1?at=2026-11-14T14:00"),
                event("encodé", "kertas:event/e%2D1"),
                { "type": "text", "text": " puis " },
                event("Réunion", "kertas:event/e-1"),
                event("ailleurs", "https://example.com/kertas:event/e-9"),
                event("vide", "kertas:event/?at=2026-11-14")
            ]}
        ]});
        assert_eq!(
            links(&document),
            vec![Link {
                kind: LinkKind::Event,
                target: "e-1".into()
            }]
        );
    }

    #[test]
    fn finds_a_cited_board_from_its_link() {
        let document = json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [
            { "type": "text", "text": "Affaire Ulule", "marks": [{ "type": "link", "attrs": { "href": "kertas:board/b-1" } }] }
        ]}]});
        assert_eq!(
            links(&document),
            vec![Link {
                kind: LinkKind::Board,
                target: "b-1".into()
            }]
        );
    }

    #[test]
    fn ignores_a_reference_without_a_target() {
        let document = json!({ "type": "doc", "content": [
            { "type": "pageRef", "attrs": { "page": "" } }
        ]});
        assert!(links(&document).is_empty());
    }
}
