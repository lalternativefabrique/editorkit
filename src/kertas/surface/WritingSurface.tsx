import { EditorContent, useEditorState, type Editor } from "@tiptap/react";
import { SelectionToolbar } from "../../SelectionToolbar";
import { blockFormats } from "../../formats";
import { useSelectionToolbar } from "../../useSelectionToolbar";
import { PdfBeside } from "../PdfBeside";
import type { Reading, WriterFiles } from "./useWriter";

const FORMATS = {
  paragraph: "Texte",
  heading1: "Grand titre",
  heading2: "Titre",
  heading3: "Petit titre",
  orderedList: "Liste numérotée",
  bulletList: "Liste",
};

const HIGHLIGHT = "#fef08a";

const COLORS = [
  { id: "red", label: "Rouge", color: "#dc2626" },
  { id: "green", label: "Vert", color: "#16a34a" },
];

const TOOLS: { label: string; glyph: string; run: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
  { label: "Titre", glyph: "H", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading") },
  { label: "Gras", glyph: "B", run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { label: "Liste", glyph: "≡", run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { label: "Citation", glyph: "“", run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
];

function formattingActions(editor: Editor) {
  return [
    {
      id: "highlight",
      label: editor.isActive("highlight") ? "Ne plus surligner" : "Surligner",
      onSelect: () => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run(),
    },
    ...COLORS.map(({ id, label, color }) => ({
      id,
      label,
      onSelect: () =>
        editor.isActive("textStyle", { color })
          ? editor.chain().focus().unsetColor().run()
          : editor.chain().focus().setColor(color).run(),
    })),
  ];
}

export type ReadOnly = "newer" | "no-engine";

const READ_ONLY: Record<ReadOnly, string> = {
  newer: "Cette note a été écrite avec une version plus récente de l’app. Elle s’ouvre en lecture seule : recharge la page pour la modifier.",
  "no-engine": "L’éditeur des notes n’a pas pu se charger. La note s’ouvre en lecture seule pour ne rien perdre de ses tableaux et de ses calculs.",
};

export function WritingTools({ editor }: { editor: Editor | null }) {
  useEditorState({ editor, selector: ({ editor: e }) => e?.state.selection });
  return (
    <div role="toolbar" aria-label="Mise en forme" className="kertas-tools">
      {TOOLS.map((tool) => (
        <button
          key={tool.label}
          type="button"
          aria-label={tool.label}
          title={tool.label}
          aria-pressed={!!editor && tool.active(editor)}
          disabled={!editor?.isEditable}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor && tool.run(editor)}
        >
          {tool.glyph}
        </button>
      ))}
    </div>
  );
}

export function WritingText({
  editor,
  files,
  reading,
  closeReading,
}: {
  editor: Editor | null;
  files: WriterFiles;
  reading: Reading | null;
  closeReading: () => void;
}) {
  const selection = useSelectionToolbar(editor);
  return (
    <>
      <div className={reading ? "kertas-text reading" : "kertas-text"}>
        {reading && editor && (
          <PdfBeside editor={editor} target={reading} resolve={files.resolve} upload={files.upload} onClose={closeReading} />
        )}
        <EditorContent editor={editor} />
      </div>
      {selection && editor && (
        <SelectionToolbar selectedText={selection.text} selection={selection.rect} formats={blockFormats(editor, FORMATS)} actions={formattingActions(editor)} />
      )}
    </>
  );
}

export function ReadOnlyWriting({ why, body, className = "" }: { why: ReadOnly; body: string; className?: string }) {
  return (
    <div className="kertas-readonly-wrap">
      <p role="status" className="kertas-readonly">
        {READ_ONLY[why]}
      </p>
      <div className={className} style={{ whiteSpace: "pre-wrap" }}>
        {body}
      </div>
    </div>
  );
}

export function CitedIn({ pages, onOpen }: { pages: { id?: string; title?: string }[]; onOpen: (id: string) => void }) {
  if (pages.length === 0) return null;
  return (
    <nav className="kertas-cited" aria-label="Notes qui citent celle-ci">
      <span className="kertas-cited-label">Cité dans</span>
      {pages.map((page) => (
        <button key={page.id} type="button" className="kertas-cited-link" onClick={() => page.id && onOpen(page.id)}>
          ↙ {page.title || "Sans titre"}
        </button>
      ))}
    </nav>
  );
}
