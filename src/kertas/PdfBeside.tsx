import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";

import { PdfReader, type PdfTarget } from "./pdf";
import type { ResolveImage, UploadImage } from "./writing";

export interface PdfBesideProps {
  editor: Editor;
  target: PdfTarget & { focus?: number };
  resolve?: ResolveImage | null;
  upload?: UploadImage | null;
  keeping?: (src: string) => Promise<{ id: string; title: string }[]>;
  openNote?: (id: string) => void;
  current?: string | null;
  onClose: () => void;
}

export function PdfBeside({ editor, target, resolve = null, upload = null, keeping, openNote, current = null, onClose }: PdfBesideProps) {
  const holder = useRef<HTMLDivElement>(null);
  const reader = useRef<PdfReader | null>(null);
  const [status, setStatus] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [elsewhere, setElsewhere] = useState<{ id: string; title: string }[]>([]);
  const [listing, setListing] = useState(false);

  useEffect(() => {
    let live = true;
    setElsewhere([]);
    void keeping?.(target.src).then((notes) => live && setElsewhere(notes.filter((note) => note.id !== current)));
    return () => {
      live = false;
    };
  }, [keeping, target.src, current]);

  useEffect(() => {
    if (!holder.current) return;
    const opened = new PdfReader(holder.current, editor, target, resolve, setStatus, upload);
    reader.current = opened;
    return () => {
      opened.destroy();
      reader.current = null;
    };
  }, [editor, target.id, target.src, resolve, upload]);

  useEffect(() => {
    reader.current?.setCapture(capturing);
  }, [capturing]);

  useEffect(() => {
    reader.current?.goTo(target.page);
  }, [target.page, target.focus]);

  return (
    <aside className="kertas-pdf-beside" aria-label={`PDF ${target.name}`}>
      <header className="kertas-pdf-beside-header">
        <span className="kertas-pdf-badge">PDF</span>
        <strong className="kertas-pdf-name">{target.name || "document.pdf"}</strong>
        <span className="kertas-pdf-meta">{status}</span>
        {elsewhere.length > 0 && (
          <span className="kertas-pdf-elsewhere">
            <button type="button" className="kertas-pdf-view" aria-expanded={listing} onClick={() => setListing((open) => !open)}>
              Dans {elsewhere.length} autre{elsewhere.length > 1 ? "s" : ""} note{elsewhere.length > 1 ? "s" : ""}
            </button>
            {listing && (
              <ul className="kertas-pdf-elsewhere-list">
                {elsewhere.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setListing(false);
                        openNote?.(note.id);
                      }}
                    >
                      {note.title || "Sans titre"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>
        )}
        {upload && (
          <button type="button" className="kertas-pdf-view" aria-pressed={capturing} onClick={() => setCapturing((on) => !on)}>
            {capturing ? "Sélectionner du texte" : "Capturer une zone"}
          </button>
        )}
        <button type="button" className="kertas-pdf-close" aria-label="Fermer le PDF" title="Fermer" onClick={onClose}>
          ×
        </button>
      </header>
      <div ref={holder} className="kertas-pdf-beside-body" />
    </aside>
  );
}
