export type Span = { start: number; end: number }

export type Folded = { chars: string; source: number[] }

/** Spoken French, spaces and punctuation included, at playback rate 1. */
export const CHARS_PER_SECOND = 15

const PREFIX_CHARS = 24

export function sentences(text: string): Span[] {
  const out: Span[] = []
  const boundary = /[.!?…]+(?=\s)|\n+/g
  let start = 0
  for (const m of text.matchAll(boundary)) {
    const end = m.index + m[0].length
    pushTrimmed(out, text, start, end)
    start = end
  }
  pushTrimmed(out, text, start, text.length)
  return out
}

function pushTrimmed(out: Span[], text: string, start: number, end: number) {
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  if (end > start) out.push({ start, end })
}

/**
 * Where in the text the voice is. A reading's duration is only known once the
 * whole of it is decoded, so a first, streamed listen runs on a speaking rate
 * until then.
 */
export function spokenOffset(position: number, duration: number | null, length: number): number {
  const at = duration && duration > 0 ? (position / duration) * length : position * CHARS_PER_SECOND
  return Math.min(Math.max(at, 0), length)
}

export function sentenceAt(spans: Span[], offset: number): number {
  let lo = 0
  let hi = spans.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid].start <= offset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * Letters and digits only, lowercased and without accents: what the spoken
 * text and the rendered page still share once Markdown, list markers and
 * typographic quotes have gone their separate ways.
 */
export function fold(text: string): Folded {
  let chars = ''
  const source: number[] = []
  for (let i = 0; i < text.length; i++) {
    const kept = text[i].normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
    for (const c of kept) {
      chars += c
      source.push(i)
    }
  }
  return { chars, source }
}

/** The folded needle's span in the folded haystack, searched from `from` on. */
export function locate(haystack: string, needle: string, from: number): Span | null {
  if (!needle) return null
  const whole = haystack.indexOf(needle, from)
  if (whole >= 0) return { start: whole, end: whole + needle.length }
  if (needle.length <= PREFIX_CHARS) return null
  const prefix = haystack.indexOf(needle.slice(0, PREFIX_CHARS), from)
  return prefix >= 0 ? { start: prefix, end: prefix + PREFIX_CHARS } : null
}

export interface ReadAlongSource {
  getSnapshot: () => { state: string; position: number; duration: number | null; text?: string | null };
  subscribe: (listener: () => void) => () => void;
}

export interface ReadAlongOptions {
  name?: string;
  follow?: boolean;
}

type Page = { nodes: Text[]; starts: number[]; folded: Folded };

/**
 * Highlights, in the page the listener is reading, the sentence the voice is
 * on. The spoken text is never the rendered one (Markdown stripped, section
 * names read aloud), so sentences are matched on their letters, forward from
 * the last match, and one the page does not show leaves the previous
 * highlight in place.
 *
 * Draws through the CSS Custom Highlight API, which leaves the DOM untouched:
 * whatever renders the page keeps owning it.
 */
export function createReadAlong(
  source: ReadAlongSource,
  root: () => HTMLElement | null,
  { name = "lalt-article-reading", follow = true }: ReadAlongOptions = {},
): () => void {
  let spoken: string | null = null;
  let spans: Span[] = [];
  let cursor = { index: -1, page: 0 };

  const update = () => {
    const { state, position, duration, text } = source.getSnapshot();
    if ((text ?? null) !== spoken) {
      spoken = text ?? null;
      spans = spoken ? sentences(spoken) : [];
    }
    const live = !!spoken && (state === "playing" || state === "paused");
    const index = live ? sentenceAt(spans, spokenOffset(position, duration, spoken!.length)) : -1;
    const registry = highlights();
    const element = root();
    if (index < 0 || !spoken || !element) {
      cursor = { index: -1, page: 0 };
      registry?.delete(name);
      return;
    }
    if (index === cursor.index) return;
    if (index < cursor.index) cursor.page = 0;
    cursor.index = index;

    const span = spans[index];
    const page = read(element);
    const found = locate(page.folded.chars, fold(spoken.slice(span.start, span.end)).chars, cursor.page);
    if (!found) return;
    cursor.page = found.end;
    if (!registry) return;
    const range = toRange(page, found);
    registry.set(name, new Highlight(range));
    if (follow && state === "playing") reveal(range);
  };

  const unsubscribe = source.subscribe(update);
  update();
  return () => {
    unsubscribe();
    highlights()?.delete(name);
  };
}

function highlights(): HighlightRegistry | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return null;
  return CSS.highlights;
}

function read(root: HTMLElement): Page {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let full = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(full.length);
    full += n.nodeValue ?? "";
  }
  return { nodes, starts, folded: fold(full) };
}

function toRange(page: Page, found: Span): Range {
  const range = document.createRange();
  const [startNode, startOffset] = pointAt(page, page.folded.source[found.start]);
  const [endNode, endOffset] = pointAt(page, page.folded.source[found.end - 1]);
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset + 1);
  return range;
}

function pointAt(page: Page, at: number): [Text, number] {
  let lo = 0;
  let hi = page.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (page.starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return [page.nodes[lo], at - page.starts[lo]];
}

function reveal(range: Range) {
  const rect = range.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
  range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
}
