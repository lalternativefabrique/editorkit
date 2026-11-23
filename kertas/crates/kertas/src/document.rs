use pulldown_cmark::{BlockQuoteKind, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;

use crate::model::{Context, Table};
use crate::table::detect_table;

const CODE_LINE_SHARE: f64 = 0.6;
/// The table of contents, as GitLab writes it.
pub const CONTENTS: &str = "[[_TOC_]]";
/// The title a link carries when it stands for a card showing the page.
pub const PREVIEW_TITLE: &str = "aperçu";
pub const PDF_TITLE: &str = "pdf";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Mark {
    Bold,
    Italic,
    Code,
    Strike,
    Highlight,
    Link { href: String },
    Math,
    DisplayMath,
    Footnote,
    Preview { href: String },
    File { href: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Inline {
    pub text: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocBlock {
    Paragraph {
        content: Vec<Inline>,
    },
    Heading {
        level: u8,
        content: Vec<Inline>,
    },
    List {
        ordered: bool,
        start: u64,
        items: Vec<Vec<DocBlock>>,
    },
    Tasks {
        items: Vec<(bool, Vec<DocBlock>)>,
    },
    Quote {
        blocks: Vec<DocBlock>,
    },
    Callout {
        tone: Tone,
        blocks: Vec<DocBlock>,
    },
    Toggle {
        open: bool,
        summary: Vec<Inline>,
        blocks: Vec<DocBlock>,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    Math {
        latex: String,
    },
    Image {
        src: String,
        alt: String,
        title: String,
    },
    Contents,
    Preview {
        url: String,
        title: String,
    },
    Pdf {
        src: String,
        name: String,
    },
    Rule,
    Table {
        table: Table,
    },
}

/// The kind of a callout, named after the GitHub alerts its Markdown uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tone {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

impl Tone {
    pub fn alert(self) -> &'static str {
        match self {
            Tone::Note => "NOTE",
            Tone::Tip => "TIP",
            Tone::Important => "IMPORTANT",
            Tone::Warning => "WARNING",
            Tone::Caution => "CAUTION",
        }
    }

    fn of(kind: BlockQuoteKind) -> Self {
        match kind {
            BlockQuoteKind::Note => Tone::Note,
            BlockQuoteKind::Tip => Tone::Tip,
            BlockQuoteKind::Important => Tone::Important,
            BlockQuoteKind::Warning => Tone::Warning,
            BlockQuoteKind::Caution => Tone::Caution,
        }
    }
}

enum Frame {
    Inlines {
        heading: Option<u8>,
        content: Vec<Inline>,
    },
    List {
        ordered: bool,
        start: u64,
        items: Vec<(Option<bool>, Vec<DocBlock>)>,
    },
    Item {
        checked: Option<bool>,
        blocks: Vec<DocBlock>,
        pending: Vec<Inline>,
    },
    Quote {
        tone: Option<Tone>,
        blocks: Vec<DocBlock>,
    },
    Code {
        language: Option<String>,
        text: String,
    },
}

fn push_inline(content: &mut Vec<Inline>, inline: Inline) {
    if inline.text.is_empty() {
        return;
    }
    match content.last_mut() {
        Some(last) if last.marks == inline.marks => last.text.push_str(&inline.text),
        _ => content.push(inline),
    }
}

fn flush_pending(pending: &mut Vec<Inline>, blocks: &mut Vec<DocBlock>) {
    if !pending.is_empty() {
        blocks.push(DocBlock::Paragraph {
            content: with_notes(std::mem::take(pending)),
        });
    }
}

/// Turns footnote calls (`[^1]`) into the notes they name.
fn with_notes(content: Vec<Inline>) -> Vec<Inline> {
    let mut out = Vec::with_capacity(content.len());
    for inline in content {
        if inline.marks.contains(&Mark::Code) || !inline.text.contains("[^") {
            out.push(inline);
            continue;
        }
        let mut rest = inline.text.as_str();
        let mut plain = String::new();
        while let Some(start) = rest.find("[^") {
            let call = rest[start + 2..]
                .find(']')
                .map(|len| (&rest[start + 2..start + 2 + len], start + 3 + len));
            let Some((label, end)) = call else {
                break;
            };
            match note_text(label) {
                Some(note) => {
                    plain.push_str(&rest[..start]);
                    push_inline(
                        &mut out,
                        Inline {
                            text: std::mem::take(&mut plain),
                            marks: inline.marks.clone(),
                        },
                    );
                    out.push(Inline {
                        text: note,
                        marks: vec![Mark::Footnote],
                    });
                }
                None => plain.push_str(&rest[..end]),
            }
            rest = &rest[end..];
        }
        plain.push_str(rest);
        push_inline(
            &mut out,
            Inline {
                text: plain,
                marks: inline.marks.clone(),
            },
        );
    }
    out
}

#[derive(Default)]
struct Builder {
    stack: Vec<Frame>,
    marks: Vec<Mark>,
    highlighted: bool,
    image: Option<(String, String, String)>,
    images: Vec<DocBlock>,
    out: Vec<DocBlock>,
}

thread_local! {
    static NOTES: std::cell::RefCell<std::collections::HashMap<String, String>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

fn note_text(label: &str) -> Option<String> {
    NOTES.with(|notes| notes.borrow().get(label).cloned())
}

impl Builder {
    fn emit(&mut self, block: DocBlock) {
        match self.stack.last_mut() {
            Some(Frame::Item {
                blocks, pending, ..
            }) => {
                flush_pending(pending, blocks);
                blocks.push(block);
            }
            Some(Frame::Quote { blocks, .. }) => blocks.push(block),
            _ => self.out.push(block),
        }
    }

    fn prose(&mut self, text: &str) {
        if matches!(self.stack.last(), Some(Frame::Code { .. })) {
            return self.text(text, None);
        }
        if let Some((_, _, alt)) = self.image.as_mut() {
            alt.push_str(text);
            return;
        }
        for (i, part) in text.split("==").enumerate() {
            if i > 0 {
                self.highlighted = !self.highlighted;
            }
            self.text(part, None);
        }
    }

    fn text(&mut self, text: &str, extra: Option<Mark>) {
        let mut marks = self.marks.clone();
        if self.highlighted {
            marks.push(Mark::Highlight);
        }
        marks.extend(extra);
        let inline = Inline {
            text: text.to_string(),
            marks,
        };
        match self.stack.last_mut() {
            Some(Frame::Inlines { content, .. }) => push_inline(content, inline),
            Some(Frame::Item { pending, .. }) => push_inline(pending, inline),
            Some(Frame::Code { text: code, .. }) => code.push_str(text),
            _ => self.emit(DocBlock::Paragraph {
                content: vec![inline],
            }),
        }
    }

    fn start(&mut self, tag: Tag) {
        match tag {
            Tag::Paragraph => self.stack.push(Frame::Inlines {
                heading: None,
                content: Vec::new(),
            }),
            Tag::Heading { level, .. } => self.stack.push(Frame::Inlines {
                heading: Some(level as u8),
                content: Vec::new(),
            }),
            Tag::BlockQuote(kind) => self.stack.push(Frame::Quote {
                tone: kind.map(Tone::of),
                blocks: Vec::new(),
            }),
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => {
                        info.split_whitespace().next().map(str::to_lowercase)
                    }
                    CodeBlockKind::Indented => None,
                };
                self.stack.push(Frame::Code {
                    language,
                    text: String::new(),
                });
            }
            Tag::List(start) => self.stack.push(Frame::List {
                ordered: start.is_some(),
                start: start.unwrap_or(1),
                items: Vec::new(),
            }),
            Tag::Item => self.stack.push(Frame::Item {
                checked: None,
                blocks: Vec::new(),
                pending: Vec::new(),
            }),
            Tag::Emphasis => self.marks.push(Mark::Italic),
            Tag::Strong => self.marks.push(Mark::Bold),
            Tag::Strikethrough => self.marks.push(Mark::Strike),
            Tag::Link {
                dest_url, title, ..
            } if title.as_ref() == PREVIEW_TITLE => self.marks.push(Mark::Preview {
                href: dest_url.to_string(),
            }),
            Tag::Link {
                dest_url, title, ..
            } if title.as_ref() == PDF_TITLE => self.marks.push(Mark::File {
                href: dest_url.to_string(),
            }),
            Tag::Link { dest_url, .. } => self.marks.push(Mark::Link {
                href: dest_url.to_string(),
            }),
            Tag::Image {
                dest_url, title, ..
            } => self.image = Some((dest_url.to_string(), title.to_string(), String::new())),
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Image => {
                if let Some((src, title, alt)) = self.image.take() {
                    self.images.push(DocBlock::Image { src, alt, title });
                }
            }
            TagEnd::Paragraph | TagEnd::Heading(_) => {
                let images = std::mem::take(&mut self.images);
                if let Some(Frame::Inlines { content, .. }) = self.stack.last()
                    && content.is_empty()
                    && !images.is_empty()
                {
                    self.stack.pop();
                    for image in images {
                        self.emit(image);
                    }
                    return;
                }
                if let Some(Frame::Inlines { heading, content }) = self.stack.pop()
                    && !content.is_empty()
                {
                    let content = with_notes(content);
                    self.emit(match (heading, content.as_slice()) {
                        (None, [only]) if only.marks == [Mark::DisplayMath] => DocBlock::Math {
                            latex: only.text.clone(),
                        },
                        (None, [only])
                            if matches!(only.marks.as_slice(), [Mark::Preview { .. }]) =>
                        {
                            let url = match &only.marks[0] {
                                Mark::Preview { href } => href.clone(),
                                _ => String::new(),
                            };
                            DocBlock::Preview {
                                url,
                                title: only.text.clone(),
                            }
                        }
                        (None, [only]) if matches!(only.marks.as_slice(), [Mark::File { .. }]) => {
                            let src = match &only.marks[0] {
                                Mark::File { href } => href.clone(),
                                _ => String::new(),
                            };
                            DocBlock::Pdf {
                                src,
                                name: only.text.clone(),
                            }
                        }
                        (Some(level), _) => DocBlock::Heading { level, content },
                        (None, _) => DocBlock::Paragraph { content },
                    });
                }
                for image in images {
                    self.emit(image);
                }
            }
            TagEnd::BlockQuote(_) => {
                if let Some(Frame::Quote { tone, blocks }) = self.stack.pop() {
                    self.emit(match tone {
                        Some(tone) => DocBlock::Callout { tone, blocks },
                        None => DocBlock::Quote { blocks },
                    });
                }
            }
            TagEnd::CodeBlock => {
                if let Some(Frame::Code { language, text }) = self.stack.pop() {
                    let text = text.trim_end_matches('\n').to_string();
                    self.emit(DocBlock::Code { language, text });
                }
            }
            TagEnd::List(_) => {
                if let Some(Frame::List {
                    ordered,
                    start,
                    items,
                }) = self.stack.pop()
                {
                    let tasks: Option<Vec<(bool, Vec<DocBlock>)>> = items
                        .iter()
                        .map(|(checked, blocks)| checked.map(|c| (c, blocks.clone())))
                        .collect();
                    self.emit(match tasks {
                        Some(items) if !ordered && !items.is_empty() => DocBlock::Tasks { items },
                        _ => DocBlock::List {
                            ordered,
                            start,
                            items: items.into_iter().map(|(_, blocks)| blocks).collect(),
                        },
                    });
                }
            }
            TagEnd::Item => {
                if let Some(Frame::Item {
                    checked,
                    mut blocks,
                    mut pending,
                }) = self.stack.pop()
                {
                    flush_pending(&mut pending, &mut blocks);
                    if let Some(Frame::List { items, .. }) = self.stack.last_mut() {
                        items.push((checked, blocks));
                    }
                }
            }
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link => {
                self.marks.pop();
            }
            _ => {}
        }
    }
}

fn markdown_blocks(text: &str) -> Vec<DocBlock> {
    let options = Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_GFM
        | Options::ENABLE_MATH;
    let mut builder = Builder::default();
    for event in Parser::new_ext(text, options) {
        match event {
            Event::Start(tag) => builder.start(tag),
            Event::End(tag) => builder.end(tag),
            Event::Text(text) | Event::Html(text) | Event::InlineHtml(text) => builder.prose(&text),
            Event::Code(text) => builder.text(&text, Some(Mark::Code)),
            Event::InlineMath(latex) => builder.text(latex.trim(), Some(Mark::Math)),
            Event::DisplayMath(latex) => builder.text(latex.trim(), Some(Mark::DisplayMath)),
            Event::SoftBreak => builder.text(" ", None),
            Event::HardBreak => builder.text("\n", None),
            Event::Rule => builder.emit(DocBlock::Rule),
            Event::TaskListMarker(done) => {
                if let Some(Frame::Item { checked, .. }) = builder.stack.last_mut() {
                    *checked = Some(done);
                }
            }
            _ => {}
        }
    }
    builder.out
}

fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

fn list_marker_len(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    if let Some(marker) = ["- ", "* ", "+ ", "• ", "– ", "— "]
        .iter()
        .find(|m| trimmed.starts_with(**m))
    {
        return Some(marker.len());
    }
    let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
    let rest = &trimmed[digits..];
    (digits > 0 && digits <= 3 && (rest.starts_with(". ") || rest.starts_with(") ")))
        .then_some(digits + 2)
}

fn as_markdown_line(line: &str) -> String {
    let indent = line.len() - line.trim_start().len();
    let trimmed = line.trim_start();
    for bullet in ["• ", "– ", "— "] {
        if let Some(rest) = trimmed.strip_prefix(bullet) {
            return format!("{}- {rest}", &line[..indent]);
        }
    }
    line.to_string()
}

fn one_paragraph_per_line(chunk: &str) -> String {
    let mut out = String::with_capacity(chunk.len() + 16);
    let mut previous: Option<&str> = None;
    let mut in_fence = false;
    for line in chunk.lines() {
        let fence = is_fence(line);
        if let Some(prev) = previous
            && !in_fence
            && !fence
            && !prev.trim().is_empty()
            && !line.trim().is_empty()
        {
            let keeps_list = list_marker_len(line).is_some()
                && (list_marker_len(prev).is_some() || line.starts_with(char::is_whitespace));
            let nested = line.starts_with(char::is_whitespace) && list_marker_len(prev).is_some();
            let quoted = line.trim_start().starts_with('>') && prev.trim_start().starts_with('>');
            if !(keeps_list || nested || quoted) {
                out.push('\n');
            }
        }
        if fence {
            in_fence = !in_fence;
        }
        out.push_str(&if in_fence || fence {
            line.to_string()
        } else {
            as_markdown_line(line)
        });
        out.push('\n');
        previous = Some(line);
    }
    out
}

fn dedent(lines: &[&str]) -> Vec<String> {
    let indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|l| {
            l.get(indent..)
                .unwrap_or(l.trim_start())
                .trim_end()
                .to_string()
        })
        .collect()
}

fn chunks(text: &str) -> Vec<Vec<&str>> {
    let mut chunks = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut in_fence = false;
    for line in text.lines() {
        if is_fence(line) {
            in_fence = !in_fence;
        }
        if line.trim().is_empty() && !in_fence {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(line);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn is_code_line(line: &str) -> bool {
    const STARTS: [&str; 34] = [
        "fn ",
        "pub ",
        "let ",
        "const ",
        "var ",
        "function ",
        "def ",
        "class ",
        "import ",
        "export ",
        "return ",
        "if (",
        "for (",
        "while (",
        "func ",
        "package ",
        "use ",
        "#include",
        "impl ",
        "struct ",
        "async ",
        "await ",
        "SELECT ",
        "INSERT ",
        "UPDATE ",
        "CREATE ",
        "$ ",
        "npm ",
        "cargo ",
        "git ",
        "pnpm ",
        "cd ",
        "print(",
        "console.",
    ];
    const SIGNS: [&str; 8] = ["=>", "::", ":=", "->", "==", "!=", "();", "){"];
    const PYTHON_BLOCKS: [&str; 9] = [
        "if ", "for ", "while ", "def ", "class ", "else", "elif ", "try", "except",
    ];
    let t = line.trim();
    if t.is_empty() {
        return false;
    }
    let is_call = t.ends_with(')')
        && t.split_once('(').is_some_and(|(callee, _)| {
            !callee.is_empty()
                && callee
                    .chars()
                    .all(|c| c.is_alphanumeric() || matches!(c, '_' | '.'))
        });
    is_call
        || STARTS.iter().any(|s| t.starts_with(s))
        || t.ends_with([';', '{', '}'])
        || t == ")"
        || SIGNS.iter().any(|s| t.contains(s))
        || (t.starts_with('"') && t.contains("\":"))
        || (t.ends_with(':') && PYTHON_BLOCKS.iter().any(|s| t.starts_with(s)))
}

fn looks_like_code(lines: &[String]) -> bool {
    let filled: Vec<&String> = lines.iter().filter(|l| !l.trim().is_empty()).collect();
    let code = filled.iter().filter(|l| is_code_line(l)).count();
    filled.len() >= 2 && code as f64 / filled.len() as f64 >= CODE_LINE_SHARE
}

fn guess_language(text: &str) -> Option<String> {
    let has = |s: &str| text.contains(s);
    let starts = |s: &str| text.lines().any(|l| l.trim_start().starts_with(s));
    let upper_starts = |s: &str| {
        text.lines()
            .any(|l| l.trim_start().to_uppercase().starts_with(s))
    };
    let language = if starts("fn ") || has("let mut ") || starts("pub ") || starts("impl ") {
        "rust"
    } else if starts("package ") || starts("func ") || has(":=") {
        "go"
    } else if starts("def ") || has("elif ") || (starts("import ") && !has(";") && !has(" from ")) {
        "python"
    } else if has(": string") || has(": number") || starts("interface ") {
        "typescript"
    } else if starts("const ")
        || starts("let ")
        || has("=>")
        || starts("function ")
        || starts("import ")
        || starts("export ")
    {
        "javascript"
    } else if ["SELECT ", "INSERT ", "UPDATE ", "CREATE ", "DELETE "]
        .iter()
        .any(|s| upper_starts(s))
    {
        "sql"
    } else if ["$ ", "npm ", "cargo ", "git ", "pnpm ", "cd ", "sudo "]
        .iter()
        .any(|s| starts(s))
    {
        "bash"
    } else if text.trim_start().starts_with(['{', '[']) && has("\":") {
        "json"
    } else {
        return None;
    };
    Some(language.to_string())
}

fn is_table_line(line: &str) -> bool {
    line.contains('\t') || line.trim_start().starts_with('|')
}

fn text_blocks(lines: &[String]) -> Vec<DocBlock> {
    let first_code = lines.iter().position(|l| is_code_line(l));
    if let Some(at) = first_code
        && looks_like_code(&lines[at..])
    {
        let mut blocks = if at > 0 {
            markdown_blocks(&one_paragraph_per_line(&lines[..at].join("\n")))
        } else {
            Vec::new()
        };
        let code = dedent(&lines[at..].iter().map(String::as_str).collect::<Vec<_>>()).join("\n");
        blocks.push(DocBlock::Code {
            language: guess_language(&code),
            text: code,
        });
        return blocks;
    }
    markdown_blocks(&one_paragraph_per_line(&lines.join("\n")))
}

fn chunk_blocks(lines: Vec<String>, context: Context) -> Vec<DocBlock> {
    if lines.iter().any(|l| is_fence(l)) {
        return markdown_blocks(&one_paragraph_per_line(&lines.join("\n")));
    }
    if let Some((table, _)) = detect_table(&lines.join("\n"), context) {
        return vec![DocBlock::Table { table }];
    }
    let mut blocks = Vec::new();
    let mut run: Vec<String> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let table_end = (i..lines.len())
            .take_while(|j| is_table_line(&lines[*j]))
            .last()
            .map(|j| j + 1);
        if let Some(end) = table_end.filter(|end| end - i >= 2)
            && let Some((table, _)) = detect_table(&lines[i..end].join("\n"), context)
        {
            blocks.extend(text_blocks(&std::mem::take(&mut run)));
            blocks.push(DocBlock::Table { table });
            i = end;
            continue;
        }
        run.push(lines[i].clone());
        i += 1;
    }
    blocks.extend(text_blocks(&run));
    blocks
}

fn merge_split_code(blocks: Vec<DocBlock>) -> Vec<DocBlock> {
    let mut out: Vec<DocBlock> = Vec::with_capacity(blocks.len());
    for block in blocks {
        if let (
            Some(DocBlock::Code {
                language: previous_language,
                text: previous,
            }),
            DocBlock::Code { language, text },
        ) = (out.last_mut(), &block)
            && (language == previous_language || language.is_none())
        {
            previous.push_str("\n\n");
            previous.push_str(text);
            continue;
        }
        out.push(block);
    }
    out
}

fn details_open(line: &str) -> Option<bool> {
    let tag = line.trim().strip_prefix("<details")?;
    let attrs = tag.strip_suffix('>')?;
    Some(attrs.split_whitespace().any(|a| a == "open"))
}

fn is_details_close(line: &str) -> bool {
    line.trim() == "</details>"
}

fn summary_of(line: &str) -> Option<&str> {
    line.trim()
        .strip_prefix("<summary>")?
        .strip_suffix("</summary>")
}

/// Takes footnote definitions ("[^1]: texte") out of the text, for the
/// references to find them whichever chunk they sit in.
fn take_notes(text: &str) -> (String, std::collections::HashMap<String, String>) {
    let mut notes = std::collections::HashMap::new();
    let mut kept = Vec::new();
    for line in text.lines() {
        let definition = line
            .trim()
            .strip_prefix("[^")
            .and_then(|rest| rest.split_once("]:"))
            .filter(|(label, _)| !label.is_empty() && !label.contains(' '));
        match definition {
            Some((label, note)) => {
                notes.insert(label.to_string(), note.trim().to_string());
            }
            None => kept.push(line),
        }
    }
    (kept.join("\n"), notes)
}

/// Reads a document, its footnotes and `<details>` blocks included.
pub fn parse_document(text: &str, context: Context) -> Vec<DocBlock> {
    let (text, notes) = take_notes(text);
    NOTES.with(|cell| *cell.borrow_mut() = notes);
    let blocks = parse_sections(&text, context);
    NOTES.with(|cell| cell.borrow_mut().clear());
    blocks
}

/// Reads `<details>` blocks, which may hold blank lines and other blocks,
/// before the rest of the text is cut into chunks at its blank lines.
fn parse_sections(text: &str, context: Context) -> Vec<DocBlock> {
    let lines: Vec<&str> = text.lines().collect();
    let mut blocks = Vec::new();
    let mut plain: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim() == CONTENTS {
            blocks.extend(parse_plain(&plain.join("\n"), context));
            plain.clear();
            blocks.push(DocBlock::Contents);
            i += 1;
            continue;
        }
        let Some(open) = details_open(lines[i]) else {
            plain.push(lines[i]);
            i += 1;
            continue;
        };
        let mut depth = 0;
        let close = (i..lines.len()).find(|&j| {
            if details_open(lines[j]).is_some() {
                depth += 1;
            } else if is_details_close(lines[j]) {
                depth -= 1;
            }
            depth == 0
        });
        let Some(close) = close else {
            plain.push(lines[i]);
            i += 1;
            continue;
        };
        blocks.extend(parse_plain(&plain.join("\n"), context));
        plain.clear();
        let mut body = &lines[i + 1..close];
        let summary = body
            .first()
            .and_then(|line| summary_of(line))
            .map(|text| {
                body = &body[1..];
                parse_plain(text, context)
                    .into_iter()
                    .find_map(|block| match block {
                        DocBlock::Paragraph { content } | DocBlock::Heading { content, .. } => {
                            Some(content)
                        }
                        _ => None,
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        blocks.push(DocBlock::Toggle {
            open,
            summary,
            blocks: parse_sections(&body.join("\n"), context),
        });
        i = close + 1;
    }
    blocks.extend(parse_plain(&plain.join("\n"), context));
    blocks
}

fn parse_plain(text: &str, context: Context) -> Vec<DocBlock> {
    let mut blocks: Vec<DocBlock> = Vec::new();
    for chunk in chunks(text) {
        let lines = dedent(&chunk);
        let continues_code = matches!(blocks.last(), Some(DocBlock::Code { .. }))
            && lines.iter().all(|l| is_code_line(l));
        if continues_code {
            blocks.push(DocBlock::Code {
                language: None,
                text: lines.join("\n"),
            });
        } else {
            blocks.extend(chunk_blocks(lines, context));
        }
    }
    merge_split_code(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::values::Day;

    const CONTEXT: Context = Context {
        today: Day {
            year: 2026,
            month: 11,
            day: 11,
        },
        lang: crate::lang::Lang::Fr,
    };

    fn kinds(blocks: &[DocBlock]) -> Vec<&'static str> {
        blocks
            .iter()
            .map(|b| match b {
                DocBlock::Paragraph { .. } => "paragraph",
                DocBlock::Heading { .. } => "heading",
                DocBlock::List { .. } => "list",
                DocBlock::Tasks { .. } => "tasks",
                DocBlock::Quote { .. } => "quote",
                DocBlock::Callout { .. } => "callout",
                DocBlock::Toggle { .. } => "toggle",
                DocBlock::Code { .. } => "code",
                DocBlock::Math { .. } => "math",
                DocBlock::Image { .. } => "image",
                DocBlock::Contents => "contents",
                DocBlock::Preview { .. } => "preview",
                DocBlock::Pdf { .. } => "pdf",
                DocBlock::Rule => "rule",
                DocBlock::Table { .. } => "table",
            })
            .collect()
    }

    fn inline(text: &str, marks: Vec<Mark>) -> Inline {
        Inline {
            text: text.into(),
            marks,
        }
    }

    #[test]
    fn reads_inline_markdown() {
        let blocks = parse_document(
            "Du **gras**, de l'*italique*, du `code` et un [lien](https://a.fr).",
            CONTEXT,
        );
        let DocBlock::Paragraph { content } = &blocks[0] else {
            unreachable!("{blocks:?}")
        };
        assert_eq!(content[1], inline("gras", vec![Mark::Bold]));
        assert_eq!(content[3], inline("italique", vec![Mark::Italic]));
        assert_eq!(content[5], inline("code", vec![Mark::Code]));
        assert_eq!(
            content[7],
            inline(
                "lien",
                vec![Mark::Link {
                    href: "https://a.fr".into()
                }]
            )
        );
    }

    #[test]
    fn keeps_one_paragraph_per_line_and_reads_bullets() {
        let blocks = parse_document(
            "# Courses\nPour ce soir.\nIl faut :\n• pain\n• lait\n  - entier\n1) payer",
            CONTEXT,
        );
        assert_eq!(
            kinds(&blocks),
            ["heading", "paragraph", "paragraph", "list", "list"]
        );
        let DocBlock::List { items, .. } = &blocks[3] else {
            unreachable!()
        };
        assert_eq!(items.len(), 2);
        assert_eq!(kinds(&items[1]), ["paragraph", "list"]);
    }

    #[test]
    fn reads_fenced_code_with_its_language() {
        let blocks = parse_document(
            "Exemple :\n```rust\nfn main() {}\n\nlet a = 1;\n```",
            CONTEXT,
        );
        assert_eq!(kinds(&blocks), ["paragraph", "code"]);
        assert_eq!(
            blocks[1],
            DocBlock::Code {
                language: Some("rust".into()),
                text: "fn main() {}\n\nlet a = 1;".into()
            }
        );
    }

    #[test]
    fn recognises_code_without_fences() {
        let text = "Voici la fonction :\n    function total(items) {\n      return items.reduce((a, b) => a + b, 0);\n    }";
        let blocks = parse_document(text, CONTEXT);
        assert_eq!(kinds(&blocks), ["paragraph", "code"]);
        let DocBlock::Code { language, text } = &blocks[1] else {
            unreachable!()
        };
        assert_eq!(language.as_deref(), Some("javascript"));
        assert!(text.starts_with("function total(items) {\n  return"));

        let python = "def hello(name):\n    print(f\"Bonjour {name}\")\n\nhello(\"Anne\")";
        let blocks = parse_document(python, CONTEXT);
        assert_eq!(kinds(&blocks), ["code"]);

        let go = parse_document("package main\nfunc main() {\n\tx := 1\n}", CONTEXT);
        assert!(matches!(&go[0], DocBlock::Code { language: Some(l), .. } if l == "go"));
    }

    #[test]
    fn finds_a_table_inside_text() {
        let blocks = parse_document(
            "Le stock du jour :\nProduit\tPrix\nClavier\t49,90 €\nSouris\t19 €\nÀ revoir demain.",
            CONTEXT,
        );
        assert_eq!(kinds(&blocks), ["paragraph", "table", "paragraph"]);
    }

    #[test]
    fn leaves_prose_as_prose() {
        let blocks = parse_document(
            "Je pars demain matin.\nTu viens avec moi ?\nOn prendra le train de 8h.",
            CONTEXT,
        );
        assert_eq!(kinds(&blocks), ["paragraph", "paragraph", "paragraph"]);
    }

    #[test]
    fn reads_quotes_rules_and_strikes() {
        let blocks = parse_document(
            "> Une citation\n> sur deux lignes\n\n---\n\n~~barré~~",
            CONTEXT,
        );
        assert_eq!(kinds(&blocks), ["quote", "rule", "paragraph"]);
    }
}
