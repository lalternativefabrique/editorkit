import { useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { PluginKey } from "@tiptap/pm/state"

import {
  PdfBeside,
  type PdfTarget,
  AutoStructure,
  Collection,
  KertasMeasure,
  kertasSlashItems,
  sectionSlashItems,
  loadKertas,
  PageRef,
  pageRefItems,
  refreshPageTitles,
  subPageItem,
  dateItems,
  emojiItems,
  mentionExtensions,
  personItems,
  Recognize,
  writingExtensions,
  writingSlashItems,
  PageSetupPanel,
  ReviewPanel,
  reviewExtensions,
  showDocument,
  BlockIds,
  formattingExtensions,
  formattingSlashItems,
  type Kertas,
  type Lang,
  type NoteRecord,
} from "../../src/kertas"
import { defaultSlashItems, SlashCommands } from "../../src/index"
import "../../src/editor.css"
import "../src/kertas.css"
import "./kertas-page.css"

const WASM = new URL("../../kertas/dist/kertas.wasm", import.meta.url)
const DICTIONARIES: Record<Lang, [URL, URL]> = {
  fr: [new URL("../../node_modules/dictionary-fr/index.aff", import.meta.url), new URL("../../node_modules/dictionary-fr/index.dic", import.meta.url)],
  en: [new URL("../../node_modules/dictionary-en/index.aff", import.meta.url), new URL("../../node_modules/dictionary-en/index.dic", import.meta.url)],
}

async function loadDictionary(engine: Kertas, lang: Lang): Promise<number> {
  const [aff, dic] = await Promise.all(DICTIONARIES[lang].map((url) => fetch(url).then((r) => r.text())))
  const started = performance.now()
  engine.loadDictionary(lang, aff, dic)
  return performance.now() - started
}

const SAMPLE_TSV = "Client\tDate\tMontant\tPayé\nPaul\t12/03/2026\t1 200,50 €\toui\nAnne\t15/03/2026\t850 €\tnon\n"

const RAW_SAMPLE = [
  "# Compte rendu du lundi",
  "Nous avons fait le **point** sur les ventes, avec un *léger* retard sur le `planning`.",
  "Points à retenir :",
  "• relancer les clients",
  "• préparer le devis",
  "  - version courte",
  "1) envoyer le devis",
  "2) attendre la réponse",
  "",
  "> Il a dit \"on verra demain\"...",
  "",
  "Produit\tPrix\tStock",
  "Clavier\t49,90 €\t12",
  "Souris\t19,00 €\t40",
  "",
  "Le calcul du total :",
  "    function total(items) {",
  "      return items.reduce((a, b) => a + b.prix, 0);",
  "    }",
  "",
  "```python",
  "def bonjour(nom):",
  "    print(f\"Bonjour {nom}\")",
  "```",
  "",
  "Voir [la doc](https://example.com) et ~~l'ancien plan~~.",
].join("\n")

const INTRO = `
<p>Écris librement ici. Essaie par exemple :</p>
<ul>
  <li><p>colle un tableau depuis un tableur (ou clique « Coller l'exemple »)</p></li>
  <li><p>tape deux lignes comme <code>Paul - 12/03 - 1 200 €</code> puis <code>Anne - 15/03 - 850 €</code></p></li>
  <li><p>tape une ligne courte, puis un paragraphe en dessous : un titre est proposé</p></li>
  <li><p>tape <code>Il a dit "oui" : l'été...</code> puis change de ligne</p></li>
  <li><p>tape <code>un systeme tres rapide, touhours prquo</code> puis change de ligne</p></li>
  <li><p>ou en anglais : <code>Can you send the reprot "today"... before noon?</code></p></li>
  <li><p>ou tape <code>/</code> pour tout faire toi-même : tableau, graphique, total, moyenne…</p></li>
  <li><p>tape <code>@</code> ou <code>[[</code> pour citer une autre page</p></li>
</ul>
<p></p>
`

function bigTsv(rows: number): string {
  const lines = ["Client\tDate\tMontant\tPayé\tRemise"]
  for (let i = 0; i < rows; i++) {
    const day = String((i % 28) + 1).padStart(2, "0")
    const month = String((i % 12) + 1).padStart(2, "0")
    const euros = (i * 37) % 5000
    const cents = String(i % 100).padStart(2, "0")
    lines.push(`Client ${i + 1}\t${day}/${month}/2026\t${euros},${cents} €\t${i % 3 === 0 ? "oui" : "non"}\t${i % 20} %`)
  }
  return lines.join("\n")
}

function paste(editor: Editor, text: string) {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
}

function bench(engine: Kertas): string {
  const paragraph = "Nous avons revu le budget de l'année avec toute l'équipe : il faut \"trancher\" vite !"
  const runs = 2000
  const started = performance.now()
  for (let i = 0; i < runs; i++) {
    engine.normalize(paragraph)
    engine.classify(paragraph, paragraph)
  }
  const perBlock = (performance.now() - started) / runs
  return `${perBlock.toFixed(3)} ms par bloc (normalize + classify, ${runs} essais)`
}

interface StoredPage {
  id: string
  title: string
  home: string | null
  stored: NoteRecord | string | null
}

const FIRST_PAGES: StoredPage[] = [
  { id: "budget", title: "Budget 2027", home: null, stored: null },
  { id: "hypotheses", title: "Hypothèses", home: null, stored: "## Croissance\n\nCinq pour cent par an, **embauches** au printemps.\n\n- marketing\n- produit" },
]

const PEOPLE = [
  { id: "marie", name: "Marie Dupont" },
  { id: "karim", name: "Karim Benali" },
  { id: "lea", name: "Léa Martin" },
]

const preview = async (url: string) => {
  const res = await fetch(`/__preview?url=${encodeURIComponent(url)}`)
  if (!res.ok) throw new Error(`preview ${res.status}`)
  return res.json()
}

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

function Page({ engine }: { engine: Kertas }) {
  const [pages, setPages] = useState<StoredPage[]>(FIRST_PAGES)
  const [current, setCurrent] = useState(FIRST_PAGES[0].id)
  const pagesRef = useRef(pages)
  const currentRef = useRef(current)
  const editorRef = useRef<Editor | null>(null)
  pagesRef.current = pages
  currentRef.current = current

  const titleOf = (id: string) => pagesRef.current.find((page) => page.id === id)?.title

  const saveCurrent = (doc: JSONContent) => {
    const stored = engine.recordNote(doc)
    const id = currentRef.current
    setPages((all) => all.map((page) => (page.id === id ? { ...page, stored } : page)))
  }

  const openPage = (id: string) => {
    const editor = editorRef.current
    const target = pagesRef.current.find((page) => page.id === id)
    if (!editor || !target || id === currentRef.current) return
    saveCurrent(editor.getJSON())
    editor.storage.kertasSuggesting.on = false
    currentRef.current = id
    setCurrent(id)
    showDocument(editor, target.stored ? engine.openNote(target.stored) : EMPTY_DOC)
    refreshPageTitles(editor, titleOf)
  }

  const createPage = (title: string, home: string | null) => {
    const page: StoredPage = { id: crypto.randomUUID(), title, home, stored: null }
    pagesRef.current = [...pagesRef.current, page]
    setPages((all) => [...all, page])
    return page
  }

  const addPage = () => openPage(createPage("Nouvelle page", null).id)

  const tree = (home: string | null, depth: number): { page: StoredPage; depth: number }[] =>
    pages.filter((page) => page.home === home).flatMap((page) => [{ page, depth }, ...tree(page.id, depth + 1)])

  const renameCurrent = (title: string) => {
    const id = currentRef.current
    setPages((all) => all.map((page) => (page.id === id ? { ...page, title } : page)))
  }

  const citedIn = useMemo(
    () =>
      pages.filter(
        (page) =>
          page.id !== current &&
          typeof page.stored === "object" &&
          page.stored?.links.some((link) => link.kind === "page" && link.target === current),
      ),
    [pages, current, engine],
  )
  const [measures, setMeasures] = useState<{ label: string; ms: number }[]>([])
  const [benchResult, setBenchResult] = useState<string>("")
  const record = (label: string, ms: number) => setMeasures((all) => [{ label, ms }, ...all].slice(0, 8))

  const [language, setLanguage] = useState<Lang>(engine.language)

  useEffect(() => {
    for (const lang of ["fr", "en"] as const) {
      loadDictionary(engine, lang).then((ms) => record(`dictionnaire ${lang}`, ms), (e: unknown) => console.error("dictionary", e))
    }
  }, [engine])

  const chooseLanguage = (lang: Lang) => {
    engine.language = lang
    setLanguage(lang)
  }

  const [reading, setReading] = useState<(PdfTarget & { focus: number }) | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, document: false }),
      AutoStructure.configure({ engine, onMeasure: record }),
      Collection.configure({ engine }),
      KertasMeasure.configure({ engine }),
      SlashCommands.configure({
        allowSpaces: true,
        emptyLabel: "",
        items: () => sectionSlashItems([
          ...defaultSlashItems(),
          ...formattingSlashItems(),
          ...writingSlashItems({ preview }),
          subPageItem(() => currentRef.current, createPage, (id) => openPage(id)),
          ...kertasSlashItems(engine),
        ]),
        pluginKey: new PluginKey("kertasSlash"),
      }),
      PageRef.configure({ openPage: (id) => openPage(id) }),
      BlockIds,
      ...formattingExtensions,
      ...mentionExtensions,
      ...reviewExtensions("Moi"),
      Recognize.configure({ engine, people: () => PEOPLE }),
      ...writingExtensions({ preview, openPdf: (target) => setReading({ ...target, focus: Date.now() }) }),
      SlashCommands.extend({ name: "kertasEmoji" }).configure({
        char: ":",
        emptyLabel: "",
        items: emojiItems,
        pluginKey: new PluginKey("kertasEmoji"),
      }),
      SlashCommands.extend({ name: "kertasPageAt" }).configure({
        char: "@",
        allowSpaces: true,
        items: (query: string) => [
          ...personItems(() => PEOPLE)(),
          ...dateItems(engine)(query),
          ...pageRefItems(() => pagesRef.current, () => currentRef.current, createPage)(query),
        ],
        pluginKey: new PluginKey("kertasPageAt"),
      }),
      SlashCommands.extend({ name: "kertasPageBrackets" }).configure({
        char: "[[",
        allowSpaces: true,
        items: pageRefItems(() => pagesRef.current, () => currentRef.current, createPage),
        pluginKey: new PluginKey("kertasPageBrackets"),
      }),
    ],
    content: INTRO,
    autofocus: "end",
    onUpdate: ({ editor }) => saveCurrent(editor.getJSON()),
    onCreate: ({ editor }) => saveCurrent(editor.getJSON()),
  })
  editorRef.current = editor

  useEffect(() => {
    if (editor) refreshPageTitles(editor, titleOf)
  }, [pages, editor])

  return (
    <div className="kp-layout">
      <main className="kp-paper">
        <input className="kp-title" value={pages.find((page) => page.id === current)?.title ?? ""} onChange={(event) => renameCurrent(event.target.value)} aria-label="Titre de la page" />
        <EditorContent editor={editor} />
        {reading && editor && <PdfBeside editor={editor} target={reading} onClose={() => setReading(null)} />}
        <details className="kp-markdown">
          <summary>Ce qui est enregistré : vue Markdown pour les agents</summary>
          <pre>{(() => {
            const stored = pages.find((page) => page.id === current)?.stored
            return typeof stored === "object" && stored ? stored.markdown : stored ?? ""
          })()}</pre>
        </details>
        {citedIn.length > 0 && (
          <footer className="kp-backlinks">
            <span>Cité dans</span>
            {citedIn.map((page) => (
              <button key={page.id} type="button" onClick={() => openPage(page.id)}>
                ↙ {page.title}
              </button>
            ))}
          </footer>
        )}
      </main>
      <aside className="kp-side">
        <h2>kertas · POC</h2>
        <h3>Pages</h3>
        <ul className="kp-pages">
          {tree(null, 0).map(({ page, depth }) => (
            <li key={page.id} style={{ paddingLeft: `${depth}rem` }}>
              <button type="button" className={page.id === current ? "kp-page-current" : undefined} onClick={() => openPage(page.id)}>
                {page.title || "Sans titre"}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="kp-page-add" onClick={addPage}>
              + Page
            </button>
          </li>
        </ul>
        <h3>Relecture</h3>
        <ReviewPanel editor={editor} author="Moi" />
        <h3>Mise en page</h3>
        <PageSetupPanel editor={editor} title={pages.find((page) => page.id === current)?.title ?? ""} />
        <label className="kp-language">
          Langue du document
          <select value={language} onChange={(event) => chooseLanguage(event.target.value as Lang)}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="kp-buttons">
          <button type="button" onClick={() => editor && paste(editor, SAMPLE_TSV)}>
            Coller l'exemple
          </button>
          <button type="button" onClick={() => editor && paste(editor, RAW_SAMPLE)}>
            Coller du texte brut
          </button>
          <button type="button" onClick={() => editor && paste(editor, bigTsv(1000))}>
            Coller 1 000 lignes
          </button>
          <button type="button" onClick={() => setBenchResult(bench(engine))}>
            Mesurer le moteur
          </button>
        </div>
        {benchResult && <p className="kp-bench">{benchResult}</p>}
        <h3>Mesures</h3>
        <ul className="kp-measures">
          {measures.map((m, i) => (
            <li key={i}>
              <span>{m.label}</span>
              <strong>{m.ms.toFixed(1)} ms</strong>
            </li>
          ))}
        </ul>
        <p className="kp-hint">Ctrl/⌘ + Z annule une restructuration d'un coup.</p>
      </aside>
    </div>
  )
}

function App() {
  const [engine, setEngine] = useState<Kertas | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadKertas(WASM).then(setEngine, (e: unknown) => setError(String(e)))
  }, [])
  if (error) return <p className="kp-error">Moteur introuvable : {error}. Lance kertas/build-wasm.sh.</p>
  if (!engine) return <p className="kp-loading">Chargement du moteur…</p>
  return <Page engine={engine} />
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
