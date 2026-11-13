import type { ReactNode } from 'react'
import type { SlashItem } from '../src/slash'

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const Glyph = ({ text }: { text: string }) => <span className="slash-glyph">{text}</span>

const Lines = ({ count = 3, short = true }: { count?: number; short?: boolean }) => (
  <div className="sp-lines">
    {Array.from({ length: count }, (_, i) => (
      <i key={i} className={short && i === count - 1 ? 'sp-short' : undefined} />
    ))}
  </div>
)

const List = ({ marker }: { marker: (i: number) => ReactNode }) => (
  <div className="sp-list">
    {[0, 1, 2].map((i) => (
      <div key={i}>
        <b>{marker(i)}</b>
        <i />
      </div>
    ))}
  </div>
)

const Grid = () => (
  <div className="sp-table">
    {Array.from({ length: 12 }, (_, i) => (
      <i key={i} className={i < 3 ? 'sp-head' : undefined} />
    ))}
  </div>
)

const Bars = () => (
  <div className="sp-chart">
    {[40, 70, 55, 90, 65].map((h, i) => (
      <i key={i} style={{ height: `${h}%` }} />
    ))}
  </div>
)

const Columns = ({ count }: { count: number }) => (
  <div className="sp-columns">
    {Array.from({ length: count }, (_, i) => (
      <Lines key={i} count={4} />
    ))}
  </div>
)

const Align = ({ side }: { side: string }) => (
  <div className={`sp-align sp-align--${side}`}>
    <i />
    <i />
    <i />
    <i />
  </div>
)

const Calc = ({ label }: { label: string }) => (
  <div className="sp-calc">
    <Grid />
    <span>{label}</span>
  </div>
)

interface Dress {
  icon: ReactNode
  description: string
  preview: ReactNode
}

const DRESS: Record<string, Dress> = {
  heading1: {
    icon: <Glyph text="H1" />,
    description: 'Le titre d’une grande partie.',
    preview: (
      <div className="sp-doc">
        <strong className="sp-h1">Grand titre</strong>
        <Lines />
      </div>
    ),
  },
  heading2: {
    icon: <Glyph text="H2" />,
    description: 'Un sous-titre à l’intérieur d’une partie.',
    preview: (
      <div className="sp-doc">
        <strong className="sp-h2">Titre</strong>
        <Lines />
      </div>
    ),
  },
  blockquote: {
    icon: (
      <Svg>
        <path d="M7 7h4v4c0 3-2 5-4 5M14 7h4v4c0 3-2 5-4 5" />
      </Svg>
    ),
    description: 'Mettre une phrase en avant.',
    preview: (
      <div className="sp-quote">
        <em>« Une phrase qui compte. »</em>
      </div>
    ),
  },
  codeBlock: {
    icon: (
      <Svg>
        <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
      </Svg>
    ),
    description: 'Du texte tel quel, en police fixe.',
    preview: (
      <pre className="sp-code">
        {'const total = 42\nprint(total)'}
      </pre>
    ),
  },
  callout: {
    icon: (
      <Svg>
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
      </Svg>
    ),
    description: 'Un encadré coloré pour une remarque.',
    preview: (
      <div className="sp-callout">
        <span>💡</span>
        <Lines count={2} />
      </div>
    ),
  },
  toggle: {
    icon: (
      <Svg>
        <path d="m9 6 6 6-6 6" />
      </Svg>
    ),
    description: 'Un bloc qu’on ouvre et ferme.',
    preview: (
      <div className="sp-toggle">
        <div>
          <b>▸</b>
          <i />
        </div>
        <Lines count={2} />
      </div>
    ),
  },
  bulletList: {
    icon: (
      <Svg>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1" fill="currentColor" />
        <circle cx="4.5" cy="18" r="1" fill="currentColor" />
      </Svg>
    ),
    description: 'Des points, sans ordre.',
    preview: <List marker={() => '•'} />,
  },
  orderedList: {
    icon: (
      <Svg>
        <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M3.5 15h3l-3 4h3" />
      </Svg>
    ),
    description: 'Des étapes, dans l’ordre.',
    preview: <List marker={(i) => `${i + 1}.`} />,
  },
  tasks: {
    icon: (
      <Svg>
        <rect x="3.5" y="4" width="6" height="6" rx="1.5" />
        <path d="m4.8 7 1.4 1.4L8.6 5.8M3.5 14h6v6h-6zM13 7h8M13 17h8" />
      </Svg>
    ),
    description: 'Des choses à faire, à cocher.',
    preview: <List marker={(i) => (i === 0 ? '☑' : '☐')} />,
  },
  'page-sub': {
    icon: (
      <Svg>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </Svg>
    ),
    description: 'Une nouvelle page rangée dans celle-ci.',
    preview: (
      <div className="sp-page">
        <span>📄</span>
        <u>Nouvelle sous-page</u>
      </div>
    ),
  },
  image: {
    icon: (
      <Svg>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.75" />
        <path d="m21 16-5-5-9 9" />
      </Svg>
    ),
    description: 'Une photo ou une capture.',
    preview: (
      <div className="sp-image">
        <div className="sp-photo">
          <span className="sp-sun" />
          <span className="sp-far" />
          <span className="sp-near" />
        </div>
        <span className="sp-caption">Coucher de soleil sur la crête</span>
      </div>
    ),
  },
  'link-preview': {
    icon: (
      <Svg>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </Svg>
    ),
    description: 'Une carte avec le titre et l’image d’un lien.',
    preview: (
      <div className="sp-link">
        <i />
        <Lines count={2} />
      </div>
    ),
  },
  'kertas-table': {
    icon: (
      <Svg>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
      </Svg>
    ),
    description: 'Des lignes et des colonnes qui calculent.',
    preview: <Grid />,
  },
  'kertas-chart': {
    icon: (
      <Svg>
        <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
      </Svg>
    ),
    description: 'Un graphique tiré d’un tableau.',
    preview: <Bars />,
  },
  formula: {
    icon: <Glyph text="∑" />,
    description: 'Une formule mathématique sur sa propre ligne.',
    preview: <div className="sp-math">x = (−b ± √Δ) / 2a</div>,
  },
  'inline-formula': {
    icon: <Glyph text="ƒx" />,
    description: 'Une formule au milieu d’une phrase.',
    preview: (
      <div className="sp-math sp-math--inline">
        soit <span>E = mc²</span> donc…
      </div>
    ),
  },
  footnote: {
    icon: <Glyph text="¹" />,
    description: 'Une précision en bas de page.',
    preview: (
      <div className="sp-doc">
        <Lines count={2} />
        <small className="sp-note">¹ La source de cette phrase.</small>
      </div>
    ),
  },
  contents: {
    icon: (
      <Svg>
        <path d="M4 6h16M8 12h12M8 18h12" />
      </Svg>
    ),
    description: 'La liste des titres de la page.',
    preview: (
      <div className="sp-toc">
        <span>1. Introduction</span>
        <span className="sp-indent">1.1 Contexte</span>
        <span>2. Résultats</span>
      </div>
    ),
  },
  'kertas-sum': { icon: <Glyph text="Σ" />, description: 'Additionner une colonne.', preview: <Calc label="Total" /> },
  'kertas-mean': { icon: <Glyph text="x̄" />, description: 'La moyenne d’une colonne.', preview: <Calc label="Moyenne" /> },
  'kertas-median': { icon: <Glyph text="M" />, description: 'La valeur du milieu.', preview: <Calc label="Médiane" /> },
  'kertas-max': { icon: <Glyph text="↑" />, description: 'La plus grande valeur.', preview: <Calc label="Maximum" /> },
  'kertas-min': { icon: <Glyph text="↓" />, description: 'La plus petite valeur.', preview: <Calc label="Minimum" /> },
  'kertas-count': { icon: <Glyph text="#" />, description: 'Compter les lignes remplies.', preview: <Calc label="Nombre" /> },
  horizontalRule: {
    icon: (
      <Svg>
        <path d="M3 12h18" />
      </Svg>
    ),
    description: 'Une ligne entre deux parties.',
    preview: (
      <div className="sp-doc">
        <Lines count={2} />
        <hr />
        <Lines count={2} />
      </div>
    ),
  },
  'columns-2': {
    icon: (
      <Svg>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 4v16" />
      </Svg>
    ),
    description: 'Deux colonnes côte à côte.',
    preview: <Columns count={2} />,
  },
  'columns-3': {
    icon: (
      <Svg>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16M15 4v16" />
      </Svg>
    ),
    description: 'Trois colonnes côte à côte.',
    preview: <Columns count={3} />,
  },
  'align-left': {
    icon: (
      <Svg>
        <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
      </Svg>
    ),
    description: 'Le texte collé à gauche.',
    preview: <Align side="left" />,
  },
  'align-center': {
    icon: (
      <Svg>
        <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
      </Svg>
    ),
    description: 'Le texte au milieu.',
    preview: <Align side="center" />,
  },
  'align-right': {
    icon: (
      <Svg>
        <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />
      </Svg>
    ),
    description: 'Le texte collé à droite.',
    preview: <Align side="right" />,
  },
  'align-justify': {
    icon: (
      <Svg>
        <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </Svg>
    ),
    description: 'Le texte aligné des deux côtés.',
    preview: <Align side="justify" />,
  },
  'kertas-tidy': {
    icon: (
      <Svg>
        <path d="m5 19 9-9M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6z" />
      </Svg>
    ),
    description: 'Remettre la page en ordre : espaces, titres, listes.',
    preview: (
      <div className="sp-doc">
        <strong className="sp-h2">Titre</strong>
        <Lines count={2} />
      </div>
    ),
  },
}

export function dressSlashItems(items: SlashItem[]): SlashItem[] {
  return items.map((item) => {
    const dress = DRESS[item.id]
    return dress ? { ...item, icon: item.icon ?? dress.icon, description: dress.description, preview: dress.preview } : item
  })
}
