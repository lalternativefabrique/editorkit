import { useEffect, useMemo, useRef, useState } from "react";
import { PluginKey } from "@tiptap/pm/state";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { SlashCommands } from "../../SlashCommands";
import { defaultSlashItems, type SlashItem } from "../../slash";
import { AutoStructure } from "../AutoStructure";
import { BlockIds } from "../blockIds";
import { Collection } from "../Collection";
import { KertasError, type Kertas } from "../engine";
import { formattingExtensions, formattingSlashItems } from "../formatting";
import { KertasMeasure } from "../measure";
import { Recognize, dateItems, emojiItems, mentionExtensions } from "../mentions";
import { PageRef, pageRefItems, type CreatePage, type PageSummary } from "../pageRef";
import type { PdfTarget } from "../pdf";
import { showDocument } from "../print";
import { reviewExtensions } from "../review";
import { kertasSlashItems } from "../slashItems";
import { sectionSlashItems } from "../slashSections";
import { topicItems } from "../topics";
import type { NoteRecord, StoredNote } from "../types";
import { writingExtensions, writingSlashItems, type ResolveImage, type UploadImage } from "../writing";
import { dressSlashItems } from "./slashDress";

export interface WriterFiles {
  upload: UploadImage;
  resolve: ResolveImage;
}

const SLASH = {
  labels: {
    heading1: "Grand titre",
    heading2: "Titre",
    bulletList: "Liste",
    orderedList: "Liste numérotée",
    blockquote: "Citation",
    codeBlock: "Code",
    horizontalRule: "Séparateur",
  },
  descriptions: {
    heading1: "le titre d’une partie",
    heading2: "un sous-titre",
    bulletList: "des points",
    orderedList: "des étapes",
    blockquote: "mettre une phrase en avant",
    codeBlock: "du texte tel quel",
    horizontalRule: "une ligne entre deux parties",
  },
};

export interface WriterPages {
  all: () => PageSummary[];
  current: () => string | null;
  create: CreatePage;
  open: (id: string) => void;
}

const single = (name: string, char: string, items: (query: string) => SlashItem[], allowSpaces = false) =>
  SlashCommands.extend({ name }).configure({ char, allowSpaces, emptyLabel: "", items, pluginKey: new PluginKey(name) });

export interface KertasWriterOptions {
  engine: Kertas;
  files: WriterFiles;
  author: string;
  pages?: WriterPages | null;
  openPdf?: (target: PdfTarget) => void;
  slash?: SlashItem[];
}

/** Every kertas writing extension, for an app that drives its own editor. */
export function kertasWriterExtensions({ engine, files, author, pages = null, openPdf = () => undefined, slash = [] }: KertasWriterOptions) {
  const cited = pages ? pageRefItems(pages.all, pages.current, pages.create) : () => [];
  return [
    StarterKit.configure({
      codeBlock: false,
      document: false,
      link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer" } },
    }),
    AutoStructure.configure({ engine }),
    Collection.configure({ engine }),
    KertasMeasure.configure({ engine }),
    BlockIds,
    ...formattingExtensions,
    ...mentionExtensions,
    ...reviewExtensions(author),
    Recognize.configure({ engine }),
    ...writingExtensions({ upload: files.upload, resolve: files.resolve, openPdf }),
    single("kertasEmoji", ":", emojiItems),
    PageRef.configure({ openPage: (id) => pages?.open(id) }),
    single("kertasAt", "@", (query) => [...dateItems(engine)(query), ...cited(query)], true),
    ...(pages ? [single("kertasBrackets", "[[", cited, true)] : []),
    single("kertasTopic", "#", topicItems(engine)),
    SlashCommands.configure({
      allowSpaces: true,
      emptyLabel: "",
      items: () =>
        dressSlashItems(
          sectionSlashItems([
            ...defaultSlashItems(SLASH),
            ...formattingSlashItems(),
            ...writingSlashItems({ upload: files.upload }),
            ...kertasSlashItems(engine),
            ...slash,
          ]),
        ),
    }),
  ];
}

function openedContent(engine: Kertas, stored: StoredNote | null, body: string): Record<string, unknown> | null {
  try {
    return engine.openNote(stored ?? body);
  } catch (error) {
    if (error instanceof KertasError) return null;
    throw error;
  }
}

export type Reading = PdfTarget & { focus: number };

export interface WriterOptions {
  engine: Kertas;
  files: WriterFiles;
  stored: StoredNote | null;
  body: string;
  label: string;
  author: string;
  /** Kept stable: a new one rebuilds the editor. */
  pages?: WriterPages | null;
  className?: string;
  onContent: (record: NoteRecord) => void;
}

/** The kertas editor of a text; `opened` is false when the text needs a newer engine. */
export function useWriter({ engine, files, stored, body, label, author, pages = null, className = "kertas-article", onContent }: WriterOptions) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [shown, setShown] = useState(false);
  const opened = useMemo(() => openedContent(engine, stored, body), [engine, stored, body]);
  const onContentRef = useRef(onContent);
  useEffect(() => {
    onContentRef.current = onContent;
  }, [onContent]);
  const extensions = useMemo(
    () =>
      kertasWriterExtensions({
        engine,
        files,
        pages,
        author,
        openPdf: (target) => setReading((prev) => ({ ...target, focus: (prev?.focus ?? 0) + 1 })),
      }),
    [engine, files, pages, author],
  );
  const editor = useEditor(
    {
      extensions,
      editable: opened !== null,
      editorProps: { attributes: { "aria-label": label, class: className } },
      onCreate: ({ editor: instance }) => {
        if (opened) showDocument(instance, opened);
        setShown(true);
      },
      onUpdate: ({ editor: instance }) => onContentRef.current(engine.recordNote(instance.getJSON())),
    },
    [extensions, opened, className],
  );
  return { editor, shown, opened: opened !== null, reading, closeReading: () => setReading(null) };
}

