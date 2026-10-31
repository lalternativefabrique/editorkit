# Editor

```sh
pnpm add @lalternative/editor @tiptap/core @tiptap/pm @tiptap/react @tiptap/starter-kit @tiptap/suggestion
```

`EditorScreen` is the page a writing surface sits in: a command bar, a title, one column of prose, and slots around them. You keep the TipTap instance and pick its extensions.

```tsx
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorScreen } from "@lalternative/editor";
import "@lalternative/editor/styles.css";

function Page() {
  const editor = useEditor({ extensions: [StarterKit] });
  return (
    <EditorScreen title={title} onTitleChange={setTitle} saveState={saveState} actions={<ShareButton />}>
      <EditorContent editor={editor} />
    </EditorScreen>
  );
}
```

| Need | Reach for |
| --- | --- |
| Toolbar on selection | `SelectionToolbar`, `useSelectionToolbar` |
| `/` commands | `SlashCommands`, `SlashMenu`, `defaultSlashItems` |
| Inline AI revisions, accepted or rejected block by block | `useRevisions`, `RevisionPrompt`, `InlineSuggestions` |
| Sources for a passage | `SourcesPanel` |
| Voice dictation | `useDictation`, `DictationButton`; you provide `transcribe(blob)` |
| Export to Markdown | `docToMarkdown` |
| Turn a conversation into a document | `conversationToNodes`, `answerToNodes` |
| Phone keyboards | `useViewport`, `placeToolbar` |
| React Native | `EditorToolbar`, `FormatSheet`, `applyFormat` from `/native` |

No model and no backend are bundled: `Revise`, `FindSources` and `transcribe` are plain async functions you write.
