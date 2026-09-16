import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import type { VaultDocument } from '../../../domain/types'
import { pagePreviewSource } from '../pagePreviewSource'

export function PageExtractSheet({ document, initialPage, busy, error, onClose, onExtract }: { document: VaultDocument; initialPage: number; busy: boolean; error: string; onClose: () => void; onExtract: (indexes: number[]) => void }) {
  const [selected, setSelected] = useState<number[]>([initialPage])
  const toggle = (index: number) => setSelected(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index].sort((a, b) => a - b))
  return <><header><div><strong>Extract pages</strong><span>Create a separate PDF; the original stays unchanged</span></div><button onClick={onClose} aria-label="Close"><X /></button></header>
    <div className="extract-page-grid">{document.pages.map((page, index) => <button key={page.id} className={selected.includes(index) ? 'selected' : ''} onClick={() => toggle(index)} aria-pressed={selected.includes(index)}><img src={pagePreviewSource(page)} alt={`Page ${index + 1}`} /><span>{selected.includes(index) && <Check />} Page {index + 1}</span></button>)}</div>
    <p className="tool-note">Select fewer than all {document.pages.length} pages.</p>
    {error && <p className="sheet-error" role="alert">{error}</p>}
    <button className="tool-primary" disabled={busy || !selected.length || selected.length === document.pages.length} onClick={() => onExtract(selected)}>{busy ? <span className="button-spinner" /> : <Copy />} {busy ? 'Creating document…' : `Extract ${selected.length || ''} ${selected.length === 1 ? 'page' : 'pages'}`}</button>
  </>
}
