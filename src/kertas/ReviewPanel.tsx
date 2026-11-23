import { useEffect, useReducer, useState } from "react";
import type { Editor } from "@tiptap/core";

import { addComment, replyToComment, resolveComment, settleSuggestion, suggestionsOf, threadsOf, type SuggestingStorage } from "./review";

function useEditorRefresh(editor: Editor | null) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);
}

function Reply({ onSend }: { onSend: (text: string) => void }) {
  return (
    <form
      className="kertas-review-reply"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("reply") as HTMLInputElement;
        onSend(input.value);
        input.value = "";
      }}
    >
      <input name="reply" placeholder="Répondre…" aria-label="Répondre" />
    </form>
  );
}

/** Comments and suggestions of a document: write them, answer, accept or refuse. */
export function ReviewPanel({ editor, author }: { editor: Editor | null; author: string }) {
  useEditorRefresh(editor);
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  if (!editor) return null;

  const storage = editor.storage.kertasSuggesting as SuggestingStorage | undefined;
  const threads = threadsOf(editor.state.doc);
  const suggestions = suggestionsOf(editor.state.doc);
  const { from, to, empty } = editor.state.selection;

  return (
    <div className="kertas-review">
      {storage && (
        <label className="kertas-review-mode">
          <input
            type="checkbox"
            checked={storage.on}
            onChange={(event) => {
              storage.on = event.target.checked;
              editor.view.dispatch(editor.state.tr.setMeta("kertasSuggesting", storage.on));
            }}
          />
          Suggérer les modifications
        </label>
      )}

      {draft ? (
        <form
          className="kertas-review-new"
          onSubmit={(event) => {
            event.preventDefault();
            const text = (event.currentTarget.elements.namedItem("comment") as HTMLTextAreaElement).value;
            if (!text.trim()) return;
            editor.chain().setTextSelection({ from: draft.from, to: draft.to }).run();
            addComment(editor, text, author);
            setDraft(null);
          }}
        >
          <textarea autoFocus name="comment" placeholder="Ton commentaire" aria-label="Commentaire" />
          <div>
            <button type="submit">
              Commenter
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button type="button" disabled={empty} onMouseDown={(event) => event.preventDefault()} onClick={() => setDraft({ from, to })}>
          Commenter la sélection
        </button>
      )}

      {threads.map((thread) => (
        <article key={thread.id} className="kertas-review-thread">
          <blockquote>{thread.quote}</blockquote>
          {thread.messages.map((message, i) => (
            <p key={i}>
              <strong>{message.author || "Quelqu'un"}</strong> {message.text}
            </p>
          ))}
          <Reply onSend={(text) => replyToComment(editor, thread.id, text, author)} />
          <button type="button" onClick={() => resolveComment(editor, thread.id)}>
            Résoudre
          </button>
        </article>
      ))}

      {suggestions.length > 0 && (
        <section className="kertas-review-suggestions">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className={`kertas-review-suggestion kertas-review-${suggestion.kind}`}>
              <span>
                {suggestion.kind === "insertion" ? "Ajout" : "Suppression"} · {suggestion.author || "Quelqu'un"}
              </span>
              <q>{suggestion.text}</q>
              <button type="button" onClick={() => settleSuggestion(editor, suggestion.id, true)}>
                Accepter
              </button>
              <button type="button" onClick={() => settleSuggestion(editor, suggestion.id, false)}>
                Refuser
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => settleSuggestion(editor, null, true)}>
              Tout accepter
            </button>
            <button type="button" onClick={() => settleSuggestion(editor, null, false)}>
              Tout refuser
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
