use std::cell::RefCell;

use serde_json::{Map, Value as Json, json};

use crate::document::{
    CONTENTS, DocBlock, Inline, Mark, PDF_TITLE, PREVIEW_TITLE, Tone, parse_document,
};
use crate::export::{Format, export};
use crate::lang::Lang;
use crate::model::{Context, Table};

const PAGE_LINK: &str = "kertas:page/";

thread_local! {
    static FOOTNOTES: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}
const DATE_LINK: &str = "kertas:date/";
const PERSON_LINK: &str = "kertas:person/";

fn children(node: &Json) -> &[Json] {
    node.get("content")
        .and_then(Json::as_array)
        .map_or(&[], Vec::as_slice)
}

fn attr<'a>(node: &'a Json, name: &str) -> Option<&'a Json> {
    node.get("attrs")?.get(name)
}

fn attr_str<'a>(node: &'a Json, name: &str) -> &'a str {
    attr(node, name).and_then(Json::as_str).unwrap_or("")
}

fn kind(node: &Json) -> &str {
    node.get("type").and_then(Json::as_str).unwrap_or("")
}

fn is_inline(node: &Json) -> bool {
    matches!(
        kind(node),
        "text"
            | "hardBreak"
            | "pageRef"
            | "kertasMeasure"
            | "inlineMath"
            | "dateRef"
            | "personRef"
            | "footnote"
    )
}

fn marked(node: &Json) -> String {
    let mut out = node
        .get("text")
        .and_then(Json::as_str)
        .unwrap_or("")
        .to_string();
    let marks = node
        .get("marks")
        .and_then(Json::as_array)
        .map_or(&[][..], Vec::as_slice);
    if marks.iter().any(|mark| kind(mark) == "insertion") {
        return String::new();
    }
    for mark in marks.iter().rev() {
        out = match kind(mark) {
            "bold" => format!("**{out}**"),
            "italic" => format!("*{out}*"),
            "strike" => format!("~~{out}~~"),
            "highlight" => format!("=={out}=="),
            "code" => format!("`{out}`"),
            "link" => format!("[{out}]({})", attr_str(mark, "href")),
            _ => out,
        };
    }
    out
}

fn inline(nodes: &[Json]) -> String {
    nodes
        .iter()
        .map(|node| match kind(node) {
            "text" => marked(node),
            "hardBreak" => "\n".to_string(),
            "pageRef" => format!(
                "[{}]({PAGE_LINK}{})",
                attr_str(node, "title"),
                attr_str(node, "page")
            ),
            "kertasMeasure" => attr_str(node, "text").to_string(),
            "inlineMath" => format!("${}$", attr_str(node, "latex")),
            "footnote" => FOOTNOTES.with(|notes| {
                let mut notes = notes.borrow_mut();
                notes.push(attr_str(node, "text").replace('\n', " "));
                format!("[^{}]", notes.len())
            }),
            "dateRef" => format!(
                "[{}]({DATE_LINK}{})",
                attr_str(node, "label"),
                attr_str(node, "date")
            ),
            "personRef" => format!(
                "[@{}]({PERSON_LINK}{})",
                attr_str(node, "name"),
                attr_str(node, "person")
            ),
            _ => inline(children(node)),
        })
        .collect()
}

fn indent(text: &str, by: usize) -> String {
    let pad = " ".repeat(by);
    text.split('\n')
        .enumerate()
        .map(|(i, line)| {
            if i == 0 || line.is_empty() {
                line.to_string()
            } else {
                format!("{pad}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn tasks(node: &Json) -> String {
    children(node)
        .iter()
        .map(|item| {
            let checked = attr(item, "checked").and_then(Json::as_bool) == Some(true);
            let marker = if checked { "- [x] " } else { "- [ ] " };
            let body = blocks(children(item)).join("\n\n");
            format!("{marker}{}", indent(&body, 2))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn quoted(lines: &str) -> String {
    lines
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                ">".to_string()
            } else {
                format!("> {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn tone(node: &Json) -> Tone {
    attr(node, "tone")
        .and_then(|tone| serde_json::from_value(tone.clone()).ok())
        .unwrap_or(Tone::Note)
}

fn toggle(node: &Json) -> String {
    let (summary, body) = children(node)
        .split_first()
        .map_or((String::new(), Vec::new()), |(first, rest)| {
            (inline(children(first)), blocks(rest))
        });
    let open = if attr(node, "open").and_then(Json::as_bool) == Some(true) {
        " open"
    } else {
        ""
    };
    let mut out = format!("<details{open}>\n<summary>{summary}</summary>");
    if !body.is_empty() {
        out.push_str("\n\n");
        out.push_str(&body.join("\n\n"));
    }
    out.push_str("\n\n</details>");
    out
}

fn list(node: &Json, ordered: bool) -> String {
    let start = attr(node, "start").and_then(Json::as_u64).unwrap_or(1);
    children(node)
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let marker = if ordered {
                format!("{}. ", start + i as u64)
            } else {
                "- ".to_string()
            };
            let body = blocks(children(item)).join("\n\n");
            format!("{marker}{}", indent(&body, marker.len()))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn block(node: &Json) -> String {
    match kind(node) {
        "paragraph" => inline(children(node)),
        "heading" => {
            let level = attr(node, "level")
                .and_then(Json::as_u64)
                .unwrap_or(2)
                .clamp(1, 6);
            format!("{} {}", "#".repeat(level as usize), inline(children(node)))
        }
        "blockquote" => blocks(children(node))
            .iter()
            .map(|b| {
                b.split('\n')
                    .map(|line| format!("> {line}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n>\n"),
        "codeBlock" => format!(
            "```{}\n{}\n```",
            attr_str(node, "language"),
            inline(children(node))
        ),
        "bulletList" => list(node, false),
        "orderedList" => list(node, true),
        "taskList" => tasks(node),
        "callout" => quoted(&format!(
            "[!{}]\n{}",
            tone(node).alert(),
            blocks(children(node)).join("\n\n")
        )),
        "toggle" => toggle(node),
        "horizontalRule" => "---".to_string(),
        "blockMath" => format!("$${}$$", attr_str(node, "latex").replace('\n', " ")),
        "tableOfContents" => CONTENTS.to_string(),
        "linkPreview" => format!(
            "[{}]({} \"{PREVIEW_TITLE}\")",
            attr_str(node, "title").replace(['[', ']'], ""),
            attr_str(node, "url")
        ),
        "pdf" => format!(
            "[{}]({} \"{PDF_TITLE}\")",
            attr_str(node, "name").replace(['[', ']'], ""),
            attr_str(node, "src")
        ),
        "excerpt" => excerpt(node),
        "image" => {
            let title = attr_str(node, "title");
            let title = if title.is_empty() {
                String::new()
            } else {
                format!(" \"{}\"", title.replace('"', "'"))
            };
            format!(
                "![{}]({}{title})",
                attr_str(node, "alt"),
                attr_str(node, "src")
            )
        }
        "collection" => attr(node, "table")
            .and_then(|table| serde_json::from_value::<Table>(table.clone()).ok())
            .map(|table| export(&table, Format::Markdown, Lang::Fr))
            .unwrap_or_default(),
        _ if children(node).iter().any(is_inline) => inline(children(node)),
        _ => blocks(children(node)).join("\n\n"),
    }
}

fn excerpt(node: &Json) -> String {
    let quote = attr_str(node, "quote");
    let page = attr(node, "page").and_then(Json::as_u64).unwrap_or(1);
    let source = if attr_str(node, "kind") == "web" {
        format!(
            "[{}]({})",
            attr_str(node, "name").replace(['[', ']'], ""),
            attr_str(node, "url")
        )
    } else {
        format!(
            "[{}, p. {page}]({EXCERPT_LINK}{}?page={page})",
            attr_str(node, "name").replace(['[', ']'], ""),
            attr_str(node, "of")
        )
    };
    if attr_str(node, "kind") == "figure" {
        return format!(
            "![{}, p. {page}]({})\n\n— {source}",
            attr_str(node, "name").replace(['[', ']'], ""),
            attr_str(node, "image")
        );
    }
    let lines: Vec<String> = quote
        .lines()
        .map(|line| format!("> {line}"))
        .chain([">".to_string(), format!("> — {source}")])
        .collect();
    lines.join("\n")
}

pub const EXCERPT_LINK: &str = "kertas:excerpt/";

fn blocks(nodes: &[Json]) -> Vec<String> {
    nodes.iter().map(block).filter(|b| !b.is_empty()).collect()
}

pub fn to_markdown(document: &Json) -> String {
    FOOTNOTES.with(|notes| notes.borrow_mut().clear());
    let mut out = blocks(children(document)).join("\n\n");
    let notes = FOOTNOTES.with(|notes| std::mem::take(&mut *notes.borrow_mut()));
    if !notes.is_empty() {
        out.push_str("\n\n");
        out.push_str(
            &notes
                .iter()
                .enumerate()
                .map(|(i, note)| format!("[^{}]: {note}", i + 1))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    out
}

fn mark_json(mark: &Mark) -> Json {
    match mark {
        Mark::Bold => json!({ "type": "bold" }),
        Mark::Italic => json!({ "type": "italic" }),
        Mark::Code => json!({ "type": "code" }),
        Mark::Strike => json!({ "type": "strike" }),
        Mark::Highlight => json!({ "type": "highlight" }),
        Mark::Math | Mark::DisplayMath | Mark::Footnote => json!({ "type": "code" }),
        Mark::Link { href } | Mark::Preview { href } | Mark::File { href } => {
            json!({ "type": "link", "attrs": { "href": href } })
        }
    }
}

fn inline_json(content: &[Inline]) -> Vec<Json> {
    let mut out = Vec::new();
    for piece in content {
        let page = piece.marks.iter().find_map(|mark| match mark {
            Mark::Link { href } => href.strip_prefix(PAGE_LINK),
            _ => None,
        });
        if let Some(page) = page {
            out.push(json!({ "type": "pageRef", "attrs": { "page": page, "title": piece.text } }));
            continue;
        }
        let href = piece.marks.iter().find_map(|mark| match mark {
            Mark::Link { href } => Some(href.as_str()),
            _ => None,
        });
        if let Some(date) = href.and_then(|href| href.strip_prefix(DATE_LINK)) {
            out.push(json!({ "type": "dateRef", "attrs": { "date": date, "label": piece.text } }));
            continue;
        }
        if let Some(person) = href.and_then(|href| href.strip_prefix(PERSON_LINK)) {
            let name = piece.text.strip_prefix('@').unwrap_or(&piece.text);
            out.push(json!({ "type": "personRef", "attrs": { "person": person, "name": name } }));
            continue;
        }
        if piece.marks.contains(&Mark::Footnote) {
            out.push(json!({ "type": "footnote", "attrs": { "text": piece.text } }));
            continue;
        }
        if piece
            .marks
            .iter()
            .any(|mark| matches!(mark, Mark::Math | Mark::DisplayMath))
        {
            out.push(json!({ "type": "inlineMath", "attrs": { "latex": piece.text } }));
            continue;
        }
        for (i, part) in piece.text.split('\n').enumerate() {
            if i > 0 {
                out.push(json!({ "type": "hardBreak" }));
            }
            if part.is_empty() {
                continue;
            }
            let mut text = Map::new();
            text.insert("type".into(), json!("text"));
            text.insert("text".into(), json!(part));
            if !piece.marks.is_empty() {
                text.insert(
                    "marks".into(),
                    Json::Array(piece.marks.iter().map(mark_json).collect()),
                );
            }
            out.push(Json::Object(text));
        }
    }
    out
}

fn with_content(mut node: Map<String, Json>, content: Vec<Json>) -> Json {
    if !content.is_empty() {
        node.insert("content".into(), Json::Array(content));
    }
    Json::Object(node)
}

fn node(kind: &str, attrs: Option<Json>) -> Map<String, Json> {
    let mut node = Map::new();
    node.insert("type".into(), json!(kind));
    if let Some(attrs) = attrs {
        node.insert("attrs".into(), attrs);
    }
    node
}

fn led_by_paragraph(mut content: Vec<Json>) -> Vec<Json> {
    if content
        .first()
        .is_none_or(|first| kind(first) != "paragraph")
    {
        content.insert(0, json!({ "type": "paragraph" }));
    }
    content
}

fn block_json(block: &DocBlock) -> Json {
    match block {
        DocBlock::Paragraph { content } => {
            with_content(node("paragraph", None), inline_json(content))
        }
        DocBlock::Heading { level, content } => with_content(
            node("heading", Some(json!({ "level": (*level).clamp(1, 6) }))),
            inline_json(content),
        ),
        DocBlock::List {
            ordered,
            start,
            items,
        } => {
            let items = items
                .iter()
                .map(|item| {
                    with_content(
                        node("listItem", None),
                        led_by_paragraph(item.iter().map(block_json).collect()),
                    )
                })
                .collect();
            if *ordered {
                with_content(node("orderedList", Some(json!({ "start": start }))), items)
            } else {
                with_content(node("bulletList", None), items)
            }
        }
        DocBlock::Tasks { items } => with_content(
            node("taskList", None),
            items
                .iter()
                .map(|(checked, blocks)| {
                    with_content(
                        node("taskItem", Some(json!({ "checked": checked }))),
                        led_by_paragraph(blocks.iter().map(block_json).collect()),
                    )
                })
                .collect(),
        ),
        DocBlock::Quote { blocks } => with_content(
            node("blockquote", None),
            blocks.iter().map(block_json).collect(),
        ),
        DocBlock::Callout { tone, blocks } => with_content(
            node("callout", Some(json!({ "tone": tone }))),
            blocks.iter().map(block_json).collect(),
        ),
        DocBlock::Toggle {
            open,
            summary,
            blocks,
        } => {
            let mut content = vec![with_content(node("paragraph", None), inline_json(summary))];
            content.extend(blocks.iter().map(block_json));
            with_content(node("toggle", Some(json!({ "open": open }))), content)
        }
        DocBlock::Code { language, text } => {
            let content = if text.is_empty() {
                Vec::new()
            } else {
                vec![json!({ "type": "text", "text": text })]
            };
            with_content(
                node("codeBlock", Some(json!({ "language": language }))),
                content,
            )
        }
        DocBlock::Math { latex } => {
            Json::Object(node("blockMath", Some(json!({ "latex": latex }))))
        }
        DocBlock::Contents => Json::Object(node("tableOfContents", None)),
        DocBlock::Preview { url, title } => Json::Object(node(
            "linkPreview",
            Some(json!({ "url": url, "title": title, "description": "", "image": "", "site": "" })),
        )),
        DocBlock::Pdf { src, name } => Json::Object(node(
            "pdf",
            Some(json!({ "src": src, "name": name, "view": "line", "page": 1 })),
        )),
        DocBlock::Image { src, alt, title } => Json::Object(node(
            "image",
            Some(
                json!({ "src": src, "alt": alt, "title": if title.is_empty() { Json::Null } else { json!(title) } }),
            ),
        )),
        DocBlock::Rule => Json::Object(node("horizontalRule", None)),
        DocBlock::Table { table } => Json::Object(node(
            "collection",
            Some(json!({ "id": null, "table": table })),
        )),
    }
}

pub fn from_markdown(markdown: &str, context: Context) -> Json {
    let content: Vec<Json> = parse_document(markdown, context)
        .iter()
        .map(block_json)
        .collect();
    let content = if content.is_empty() {
        vec![json!({ "type": "paragraph" })]
    } else {
        content
    };
    json!({ "type": "doc", "content": content })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lang::Lang;
    use crate::values::Day;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: Lang::Fr,
    };

    fn text(t: &str) -> Json {
        json!({ "type": "text", "text": t })
    }

    #[test]
    fn writes_every_block_of_a_document() {
        let document = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 2, "id": "b1" }, "content": [text("Budget")] },
            { "type": "paragraph", "content": [
                text("Voir "),
                { "type": "pageRef", "attrs": { "page": "p-2", "title": "Hypothèses" } },
                text(", "),
                { "type": "text", "text": "vite", "marks": [{ "type": "bold" }] },
                text(".")
            ]},
            { "type": "collection", "attrs": { "id": "t-1", "table": {
                "columns": [
                    { "name": "Mois", "property": { "type": "text" } },
                    { "name": "Montant", "property": { "type": "money", "currency": "EUR" } }
                ],
                "rows": [[
                    { "raw": "janvier", "display": "janvier" },
                    { "raw": "1 200 €", "display": "1 200,00 €", "typed": { "type": "money", "minor": 120000, "currency": "EUR" } }
                ]]
            }}},
            { "type": "paragraph", "content": [
                { "type": "kertasMeasure", "attrs": { "table": "t-1", "text": "Total (Montant) : 1 200,00 €" } }
            ]},
            { "type": "bulletList", "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("un")] }] },
                { "type": "listItem", "content": [
                    { "type": "paragraph", "content": [text("deux")] },
                    { "type": "bulletList", "content": [
                        { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("deux bis")] }] }
                    ]}
                ]}
            ]},
            { "type": "unknownFutureBlock", "content": [text("rien ne se perd")] }
        ]});
        assert_eq!(
            to_markdown(&document),
            [
                "## Budget",
                "Voir [Hypothèses](kertas:page/p-2), **vite**.",
                "| Mois | Montant |\n| --- | --- |\n| janvier | 1 200,00 € |",
                "Total (Montant) : 1 200,00 €",
                "- un\n- deux\n\n  - deux bis",
                "rien ne se perd",
            ]
            .join("\n\n")
        );
    }

    #[test]
    fn a_note_written_today_survives_the_trip_to_json_and_back() {
        let note = [
            "# Compte rendu",
            "Nous avons fait le **point** sur les *ventes* avec `planning` et [la doc](https://example.com).",
            "## Décisions",
            "- relancer les clients\n- préparer le devis",
            "1. envoyer\n2. attendre",
            "> Il a dit oui.",
            "```python\nprint(\"ok\")\n```",
            "---",
            "Voir [Hypothèses](kertas:page/p-2).",
        ]
        .join("\n\n");
        let document = from_markdown(&note, CONTEXT);
        assert_eq!(to_markdown(&document), note);
    }

    #[test]
    fn an_editor_document_survives_the_trip_to_markdown_and_back() {
        let document = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 1 }, "content": [text("Titre")] },
            { "type": "paragraph", "content": [
                text("Un "),
                { "type": "text", "text": "mot", "marks": [{ "type": "italic" }] },
                text(" et "),
                { "type": "pageRef", "attrs": { "page": "p-9", "title": "Annexe" } }
            ]},
            { "type": "orderedList", "attrs": { "start": 3 }, "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("trois")] }] },
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("quatre")] }] }
            ]},
            { "type": "blockquote", "content": [{ "type": "paragraph", "content": [text("Citée.")] }] },
            { "type": "codeBlock", "attrs": { "language": "rust" }, "content": [text("fn main() {}")] },
            { "type": "horizontalRule" }
        ]});
        assert_eq!(from_markdown(&to_markdown(&document), CONTEXT), document);
    }

    #[test]
    fn a_page_link_comes_back_as_a_citation() {
        let document = from_markdown("Voir [Hypothèses](kertas:page/p-2).", CONTEXT);
        let first = &children(&document)[0];
        assert_eq!(
            children(first)[1],
            json!({ "type": "pageRef", "attrs": { "page": "p-2", "title": "Hypothèses" } })
        );
    }

    #[test]
    fn a_markdown_table_comes_back_as_a_typed_collection() {
        let document = from_markdown(
            "| Client | Montant |\n| --- | --- |\n| Paul | 12 € |",
            CONTEXT,
        );
        let collection = &children(&document)[0];
        assert_eq!(kind(collection), "collection");
        assert_eq!(
            attr(collection, "table").and_then(|t| t.pointer("/columns/1/property/type")),
            Some(&json!("money"))
        );
    }

    #[test]
    fn an_empty_note_is_one_empty_paragraph() {
        assert_eq!(
            from_markdown("", CONTEXT),
            json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
        );
    }

    fn formatted() -> Json {
        let paragraph = |content: Vec<Json>| json!({ "type": "paragraph", "content": content });
        json!({ "type": "doc", "content": [
            paragraph(vec![
                text("Un mot "),
                json!({ "type": "text", "text": "surligné", "marks": [{ "type": "highlight" }] }),
                text("."),
            ]),
            { "type": "taskList", "content": [
                { "type": "taskItem", "attrs": { "checked": true }, "content": [paragraph(vec![text("relancer")])] },
                { "type": "taskItem", "attrs": { "checked": false }, "content": [paragraph(vec![text("chiffrer")])] }
            ]},
            { "type": "callout", "attrs": { "tone": "warning" }, "content": [
                paragraph(vec![text("Avant vendredi.")]),
                paragraph(vec![text("Sans faute.")])
            ]},
            { "type": "toggle", "attrs": { "open": false }, "content": [
                paragraph(vec![text("Détails")]),
                paragraph(vec![text("Premier.")]),
                paragraph(vec![text("Second.")])
            ]}
        ]})
    }

    #[test]
    fn writes_and_reads_a_card_showing_a_page() {
        let document = json!({ "type": "doc", "content": [
            { "type": "linkPreview", "attrs": { "url": "https://exemple.fr/budget", "title": "Le budget [2027]", "description": "Ce qui change.", "image": "https://exemple.fr/c.png", "site": "exemple.fr" } },
            { "type": "paragraph", "content": [
                { "type": "text", "text": "un lien", "marks": [{ "type": "link", "attrs": { "href": "https://exemple.fr" } }] }
            ]}
        ]});
        let markdown = to_markdown(&document);
        assert_eq!(
            markdown,
            "[Le budget 2027](https://exemple.fr/budget \"aperçu\")\n\n[un lien](https://exemple.fr)"
        );
        let read = from_markdown(&markdown, CONTEXT);
        assert_eq!(read.pointer("/content/0/type"), Some(&json!("linkPreview")));
        assert_eq!(
            read.pointer("/content/0/attrs/url"),
            Some(&json!("https://exemple.fr/budget"))
        );
        assert_eq!(read.pointer("/content/1/type"), Some(&json!("paragraph")));
    }

    #[test]
    fn writes_and_reads_a_contents_an_image_and_footnotes() {
        let document = json!({ "type": "doc", "content": [
            { "type": "tableOfContents" },
            { "type": "paragraph", "content": [
                text("Le devis"),
                { "type": "footnote", "attrs": { "text": "Hors taxes." } },
                text(" et la remise"),
                { "type": "footnote", "attrs": { "text": "Valable un mois." } },
                text(".")
            ]},
            { "type": "image", "attrs": { "src": "https://exemple.fr/plan.png", "alt": "Le plan", "title": null } },
            { "type": "columns", "content": [
                { "type": "column", "content": [{ "type": "paragraph", "content": [text("À gauche")] }] },
                { "type": "column", "content": [{ "type": "paragraph", "content": [text("À droite")] }] }
            ]}
        ]});
        let markdown = to_markdown(&document);
        assert_eq!(
            markdown,
            "[[_TOC_]]\n\nLe devis[^1] et la remise[^2].\n\n![Le plan](https://exemple.fr/plan.png)\n\nÀ gauche\n\nÀ droite\n\n[^1]: Hors taxes.\n[^2]: Valable un mois."
        );
        let read = from_markdown(&markdown, CONTEXT);
        let content = read["content"].as_array().cloned().unwrap_or_default();
        assert_eq!(
            content[..3],
            document["content"].as_array().cloned().unwrap_or_default()[..3]
        );
    }

    #[test]
    fn writes_the_text_as_it_stands_before_suggestions_and_without_comments() {
        let document = json!({ "type": "doc", "attrs": { "comments": { "c1": { "quote": "devis", "messages": [] } } }, "content": [
            { "type": "paragraph", "content": [
                text("Le "),
                { "type": "text", "text": "devis", "marks": [{ "type": "comment", "attrs": { "id": "c1" } }] },
                text(" est "),
                { "type": "text", "text": "presque ", "marks": [{ "type": "deletion", "attrs": { "id": "s1", "author": "Léa" } }] },
                { "type": "text", "text": "tout à fait ", "marks": [{ "type": "insertion", "attrs": { "id": "s2", "author": "Léa" } }] },
                text("prêt.")
            ]}
        ]});
        assert_eq!(to_markdown(&document), "Le devis est presque prêt.");
    }

    #[test]
    fn writes_and_reads_dates_and_people() {
        let document = json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                { "type": "personRef", "attrs": { "person": "m-1", "name": "Marie" } },
                text(" rappelle "),
                { "type": "dateRef", "attrs": { "date": "2026-11-14", "label": "vendredi 14 novembre" } },
                text(".")
            ]}
        ]});
        let markdown = to_markdown(&document);
        assert_eq!(
            markdown,
            "[@Marie](kertas:person/m-1) rappelle [vendredi 14 novembre](kertas:date/2026-11-14)."
        );
        assert_eq!(from_markdown(&markdown, CONTEXT), document);
    }

    #[test]
    fn writes_and_reads_formulas() {
        let document = json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [
                text("Soit "),
                { "type": "inlineMath", "attrs": { "latex": "x^2" } },
                text(" positif.")
            ]},
            { "type": "blockMath", "attrs": { "latex": "\\sum_{i=1}^{n} x_i" } }
        ]});
        let markdown = to_markdown(&document);
        assert_eq!(markdown, "Soit $x^2$ positif.\n\n$$\\sum_{i=1}^{n} x_i$$");
        assert_eq!(from_markdown(&markdown, CONTEXT), document);
    }

    #[test]
    fn writes_tasks_highlights_callouts_and_toggles() {
        assert_eq!(
            to_markdown(&formatted()),
            "Un mot ==surligné==.\n\n- [x] relancer\n- [ ] chiffrer\n\n> [!WARNING]\n> Avant vendredi.\n>\n> Sans faute.\n\n<details>\n<summary>Détails</summary>\n\nPremier.\n\nSecond.\n\n</details>"
        );
    }

    #[test]
    fn reads_them_back_from_their_markdown() {
        assert_eq!(
            from_markdown(&to_markdown(&formatted()), CONTEXT),
            formatted()
        );
    }

    #[test]
    fn a_pdf_and_its_excerpt_read_as_markdown_and_the_pdf_comes_back() {
        let document = json!({ "type": "doc", "content": [
            { "type": "pdf", "attrs": { "id": "b-1", "src": "resource:r-1", "name": "dutta [2021].pdf", "view": "reader", "page": 3 } },
            { "type": "excerpt", "attrs": { "of": "b-1", "name": "dutta.pdf", "page": 3, "quote": "Observation is hard.\nVery hard.", "rects": [] } }
        ]});
        let markdown = to_markdown(&document);
        assert_eq!(
            markdown,
            "[dutta 2021.pdf](resource:r-1 \"pdf\")\n\n> Observation is hard.\n> Very hard.\n>\n> — [dutta.pdf, p. 3](kertas:excerpt/b-1?page=3)"
        );
        let read = from_markdown(&markdown, CONTEXT);
        assert_eq!(read.pointer("/content/0/type"), Some(&json!("pdf")));
        assert_eq!(
            read.pointer("/content/0/attrs/src"),
            Some(&json!("resource:r-1"))
        );
        assert_eq!(read.pointer("/content/1/type"), Some(&json!("blockquote")));
    }

    #[test]
    fn a_figure_taken_from_a_pdf_reads_as_an_image_with_its_page() {
        let document = json!({ "type": "doc", "content": [
            { "type": "excerpt", "attrs": { "of": "b-1", "name": "dutta.pdf", "page": 4, "quote": "", "kind": "figure", "image": "resource:r-9" } }
        ]});
        assert_eq!(
            to_markdown(&document),
            "![dutta.pdf, p. 4](resource:r-9)\n\n— [dutta.pdf, p. 4](kertas:excerpt/b-1?page=4)"
        );
    }

    #[test]
    fn a_passage_of_a_web_page_reads_as_a_quote_with_its_page() {
        let document = json!({ "type": "doc", "content": [
            { "type": "excerpt", "attrs": { "of": "", "name": "Le Monde", "page": 0, "quote": "Les équipes se cloisonnent.", "kind": "web", "url": "https://lemonde.fr/a" } }
        ]});
        assert_eq!(
            to_markdown(&document),
            "> Les équipes se cloisonnent.\n>\n> — [Le Monde](https://lemonde.fr/a)"
        );
    }
}
