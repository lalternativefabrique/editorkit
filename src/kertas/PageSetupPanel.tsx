import type { Editor } from "@tiptap/core";

import { DEFAULT_PAGE_SETUP, PAGE_SETUP_LABELS, type PageSetup, pageSetupOf, printDocument } from "./print";

export function setPageSetup(editor: Editor, setup: PageSetup): void {
  editor.view.dispatch(editor.state.tr.setDocAttribute("page", setup));
}

function Choice<K extends "size" | "orientation" | "margins">({
  field,
  setup,
  onChange,
}: {
  field: K;
  setup: PageSetup;
  onChange: (setup: PageSetup) => void;
}) {
  const options = PAGE_SETUP_LABELS[field] as Record<string, string>;
  return (
    <select
      value={setup[field]}
      onChange={(event) => onChange({ ...setup, [field]: event.target.value })}
      aria-label={{ size: "Format", orientation: "Orientation", margins: "Marges" }[field]}
    >
      {Object.entries(options).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** How a document is printed, kept in the document, and a button to print it. */
export function PageSetupPanel({ editor, title }: { editor: Editor | null; title: string }) {
  const setup = editor ? pageSetupOf(editor.state.doc) : DEFAULT_PAGE_SETUP;
  const change = (next: PageSetup) => editor && setPageSetup(editor, next);
  return (
    <div className="kertas-page-setup">
      <Choice field="size" setup={setup} onChange={change} />
      <Choice field="orientation" setup={setup} onChange={change} />
      <Choice field="margins" setup={setup} onChange={change} />
      <label>
        <input type="checkbox" checked={setup.header} onChange={(event) => change({ ...setup, header: event.target.checked })} />
        Titre en en-tête
      </label>
      <label>
        <input type="checkbox" checked={setup.numbers} onChange={(event) => change({ ...setup, numbers: event.target.checked })} />
        Numéros de page
      </label>
      <button type="button" disabled={!editor} onClick={() => editor && printDocument(setup, title, editor.view.dom)}>
        Imprimer
      </button>
    </div>
  );
}
