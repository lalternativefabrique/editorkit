import type { ReactNode } from 'react'

export const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const Glyph = ({ text }: { text: string }) => <span className="slash-glyph">{text}</span>

export const Lines = ({ count = 3, short = true }: { count?: number; short?: boolean }) => (
  <div className="sp-lines">
    {Array.from({ length: count }, (_, i) => (
      <i key={i} className={short && i === count - 1 ? 'sp-short' : undefined} />
    ))}
  </div>
)

export const List = ({ marker }: { marker: (i: number) => ReactNode }) => (
  <div className="sp-list">
    {[0, 1, 2].map((i) => (
      <div key={i}>
        <b>{marker(i)}</b>
        <i />
      </div>
    ))}
  </div>
)

export const Grid = () => (
  <div className="sp-table">
    {Array.from({ length: 12 }, (_, i) => (
      <i key={i} className={i < 3 ? 'sp-head' : undefined} />
    ))}
  </div>
)

export const Bars = () => (
  <div className="sp-chart">
    {[40, 70, 55, 90, 65].map((h, i) => (
      <i key={i} style={{ height: `${h}%` }} />
    ))}
  </div>
)

export const Columns = ({ count }: { count: number }) => (
  <div className="sp-columns">
    {Array.from({ length: count }, (_, i) => (
      <Lines key={i} count={4} />
    ))}
  </div>
)

export const Align = ({ side }: { side: string }) => (
  <div className={`sp-align sp-align--${side}`}>
    <i />
    <i />
    <i />
    <i />
  </div>
)

export const Calc = ({ label }: { label: string }) => (
  <div className="sp-calc">
    <Grid />
    <span>{label}</span>
  </div>
)

