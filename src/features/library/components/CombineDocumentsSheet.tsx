import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Files, Lock, X } from 'lucide-react'
import type { VaultDocument } from '../../../domain/types'

export function CombineDocumentsSheet({ documents, onClose, onCombine }: { documents: VaultDocument[]; onClose: () => void; onCombine: (documents: VaultDocument[]) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const overflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const move = (id: string, offset: -1 | 1) => setSelected(current => {
    const index = current.indexOf(id), target = index + offset
    if (index < 0 || target < 0 || target >= current.length) return current
    const reordered = [...current]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    return reordered
  })
  const combine = async () => {
    setBusy(true); setError('')
    try { await onCombine(selected.map(id => documents.find(document => document.id === id)!).filter(Boolean)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not combine these documents.'); setBusy(false) }
  }
  return <div className="tool-sheet-layer" onClick={onClose} role="presentation"><section className="tool-sheet" role="dialog" aria-modal="true" aria-label="Combine documents" onClick={event => event.stopPropagation()}>
    <header><div><Files /><span><strong>Combine documents</strong><small>Tap files in the order they should appear</small></span></div><button onClick={onClose} aria-label="Close"><X /></button></header>
    <div className="combine-list">{documents.map(document => { const position = selected.indexOf(document.id); return <article key={document.id} className={position >= 0 ? 'selected' : ''}>
      <button className="combine-select" onClick={() => toggle(document.id)} aria-pressed={position >= 0}><span className="selection-order">{position >= 0 ? position + 1 : ''}</span><span><strong>{document.isPrivate ? <><Lock /> Private document</> : document.title}</strong><small>{document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'}</small></span>{position >= 0 && <Check />}</button>
      {position >= 0 && <div className="combine-order"><button disabled={position === 0} onClick={() => move(document.id, -1)} aria-label="Move earlier"><ArrowUp /></button><button disabled={position === selected.length - 1} onClick={() => move(document.id, 1)} aria-label="Move later"><ArrowDown /></button></div>}
    </article> })}</div>
    {error && <p className="sheet-error" role="alert">{error}</p>}
    <button className="tool-primary" disabled={busy || selected.length < 2} onClick={() => void combine()}>{busy ? <span className="button-spinner" /> : <Files />} {busy ? 'Combining locally…' : `Combine ${selected.length || ''} documents`}</button>
  </section></div>
}
