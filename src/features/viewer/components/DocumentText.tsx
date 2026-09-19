import { useEffect, useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import type { VaultDocument } from '../../../domain/types'
import { copyDocumentText, parseTextPageRange } from '../../../services/textSelection'
import { exportOcrText } from '../../../services/textExportService'

export function DocumentText({ document, initialPages = [], currentPage, onPage, onCopy, onExport, hideText = false, reading = false }: {
  document: VaultDocument; initialPages?: number[]; currentPage?: number; onPage?: (page: number) => void;
  onCopy?: (indexes: number[]) => Promise<void>; onExport?: (format: 'txt' | 'md', indexes: number[]) => Promise<void>;
  hideText?: boolean; reading?: boolean;
}) {
  const [selected, setSelected] = useState(initialPages)
  const [range, setRange] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const previousPage = useRef<number | undefined>(currentPage === 0 ? 0 : undefined)
  useEffect(() => {
    if (currentPage === undefined || previousPage.current === currentPage) return
    previousPage.current = currentPage
    root.current?.querySelector(`[data-text-page="${currentPage}"]`)?.scrollIntoView({ block: 'start' })
  }, [currentPage])
  const toggle = (index: number) => { setSelected(values => values.includes(index) ? values.filter(value => value !== index) : [...values, index].sort((a, b) => a - b)); setMessage('') }
  const run = async (action: () => Promise<void>, success: string) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setMessage(''); setError('')
    try { await action(); setMessage(success) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not copy or export text. Please try again.') }
    finally { pending.current = false; setBusy(false) }
  }
  const copy = (indexes: number[]) => void run(() => onCopy ? onCopy(indexes) : copyDocumentText(document, indexes), `Text from ${indexes.length} ${indexes.length === 1 ? 'page' : 'pages'} copied`)
  const all = () => { setSelected(document.pages.map((_, index) => index)); setMessage('') }
  return <div ref={root} className={`document-text${reading ? ' reading' : ''}`}>
    <div className="text-selection-tools">
      <div><span>{selected.length ? `${selected.length} selected` : 'Select pages to copy together'}</span><button disabled={busy} onClick={all}>Select all</button><button disabled={busy || !selected.length} onClick={() => { setSelected([]); setMessage('') }}>Clear</button></div>
      <button className="text-copy-selected" disabled={busy || !selected.length} onClick={() => copy(selected)}><Copy size={16} />{busy ? 'Working…' : `Copy ${selected.length || ''} ${selected.length === 1 ? 'page' : 'pages'}`}</button>
    </div>
    <details className="text-range-options"><summary>Page range & export</summary>
      <form onSubmit={event => { event.preventDefault(); try { setSelected(parseTextPageRange(range, document.pages.length)); setError(''); setMessage('') } catch (cause) { setError((cause as Error).message) } }}>
        <label>Pages<input value={range} onChange={event => setRange(event.target.value)} placeholder="1, 3-5" aria-label="Text page range" /></label><button disabled={busy}>Select range</button>
      </form>
      <div className="text-export-actions">{(['txt', 'md'] as const).map(format => <button key={format} disabled={busy || !selected.length} onClick={() => void run(() => onExport ? onExport(format, selected) : exportOcrText(document, format, selected), 'Selected page text exported')}><Download size={16} />{format === 'txt' ? 'Text (.txt)' : 'Markdown (.md)'}</button>)}</div>
    </details>
    {message ? <p className="text-feedback" role="status">{message}</p> : null}
    {error ? <p className="sheet-error" role="alert">{error}</p> : null}
    <p className="text-recognition-note">Recognised text may contain errors. You can also select a passage using your device’s text selection.</p>
    {hideText ? <p className="text-recognition-note">Private text stays hidden here. Copy or export authenticates before accessing the selected pages.</p> : null}
    {document.pages.map((item, index) => <article key={item.id} data-text-page={index} className={`text-page${index === currentPage ? ' current' : ''}`}>
      <header><label><input type="checkbox" checked={selected.includes(index)} disabled={busy} onChange={() => toggle(index)} aria-label={`Select page ${index + 1} text`} /><span>Page {index + 1}</span></label><button disabled={busy} onClick={() => { onPage?.(index); copy([index]) }} aria-label={`Copy page ${index + 1} text`} title={`Copy page ${index + 1}`}><Copy size={16} /></button></header>
      {!hideText ? <p className={item.ocrText.trim() ? '' : 'empty'}>{item.ocrText.trim() || 'No text was detected on this page.'}</p> : null}
    </article>)}
  </div>
}
