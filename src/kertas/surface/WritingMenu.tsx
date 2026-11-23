import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { PageSetupPanel } from "../PageSetupPanel";
import { ReviewPanel } from "../ReviewPanel";
import { toDocx, type DocxNode } from "../docx";
import type { Kertas } from "../engine";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 80).trim();
  return `${base || "Note"}.docx`;
}

function downloadDocx(editor: Editor, title: string, engine: Kertas): void {
  const bytes = toDocx(editor.getJSON() as DocxNode, { title, engine, lang: "fr" });
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Panel = "menu" | "review" | "print" | null;

export function WritingMenu({ editor, engine, title, author }: { editor: Editor | null; engine: Kertas; title: string; author: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panel) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setPanel(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [panel]);

  if (!editor) return null;
  const item = (label: string, hint: string, run: () => void) => (
    <button type="button" role="menuitem" className="kertas-menu-item" onClick={run}>
      <span>{label}</span>
      <span className="kertas-menu-hint">{hint}</span>
    </button>
  );

  return (
    <div className="kertas-menu" ref={box}>
      <button
        type="button"
        className="kertas-menu-toggle"
        aria-label="Plus d’actions"
        aria-haspopup="menu"
        aria-expanded={panel !== null}
        onClick={() => setPanel(panel ? null : "menu")}
      >
        ⋯
      </button>
      {panel === "menu" && (
        <div role="menu" className="kertas-menu-panel">
          {item("Relire…", "commentaires et suggestions", () => setPanel("review"))}
          {item("Imprimer…", "format, marges, en-tête, numéros de page", () => setPanel("print"))}
          {item("Exporter en Word", "fichier .docx, titres et sommaire compris", () => {
            setPanel(null);
            downloadDocx(editor, title || "Sans titre", engine);
          })}
        </div>
      )}
      {panel === "review" && (
        <div aria-label="Relecture" className="kertas-menu-panel kertas-menu-wide">
          <ReviewPanel editor={editor} author={author} />
        </div>
      )}
      {panel === "print" && (
        <div aria-label="Mise en page" className="kertas-menu-panel kertas-menu-wide">
          <PageSetupPanel editor={editor} title={title || "Sans titre"} />
        </div>
      )}
    </div>
  );
}
