import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Copy, Download, Eraser, Files, FileText, FilePlus2, GripVertical, Lock, Minimize2, PencilLine, Search, SlidersHorizontal, X } from 'lucide-react'
import type { VaultDocument } from '../../domain/types'
import type { PdfCompressionLevel } from '../../services/pdfService'
import { CompressionSheet } from '../viewer/components/CompressionSheet'
import { PageExtractSheet } from '../viewer/components/PageExtractSheet'
import { documentStorageService } from '../../services/documentStorageService'
import type { PageCleanupAnalysis } from '../../services/documentOperationsService'

type ActionMode = 'combine' | 'split' | 'reorder' | 'compress' | 'insert' | 'clean' | 'rename' | 'export'
export type ActionSaveMode = 'copy' | 'replace'
type PrivacyFilter = 'all' | 'public' | 'private'
type DateFilter = 'all' | 'week' | 'month' | 'year'
type SortOrder = 'recent' | 'oldest' | 'title' | 'pages'
type PickerPreferences = { version: 1; folder: string; tag: string; type: string; privacy: PrivacyFilter; date: DateFilter; sort: SortOrder }
const PICKER_PREFERENCES_KEY = 'local.actions-picker.preferences.v1'
const DEFAULT_PREFERENCES: PickerPreferences = { version: 1, folder: 'All folders', tag: 'All tags', type: 'All types', privacy: 'all', date: 'all', sort: 'recent' }
let cachedPickerPreferences: PickerPreferences | undefined
function pickerPreferences() {
  if (cachedPickerPreferences) return cachedPickerPreferences
  try { const saved = JSON.parse(localStorage.getItem(PICKER_PREFERENCES_KEY) ?? '') as PickerPreferences; cachedPickerPreferences = saved.version === 1 ? saved : DEFAULT_PREFERENCES }
  catch { cachedPickerPreferences = DEFAULT_PREFERENCES }
  return cachedPickerPreferences
}
const formatType = (value?: string) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : 'Unclassified'
const formatSize = (bytes?: number) => bytes === undefined ? 'Calculating size…' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
function searchSnippet(document: VaultDocument, query: string) {
  if (!query) return ''
  for (const page of document.pages) { const index = page.ocrText.toLocaleLowerCase().indexOf(query); if (index >= 0) return `${index > 0 ? '…' : ''}${page.ocrText.slice(Math.max(0, index - 36), index + query.length + 54).replace(/\s+/g, ' ').trim()}${index + query.length + 54 < page.ocrText.length ? '…' : ''}` }
  return ''
}

interface ActionsScreenProps {
  documents: VaultDocument[]
  onCombine: (documents: VaultDocument[]) => Promise<void>
  onExtract: (document: VaultDocument, indexes: number[]) => Promise<void>
  onReorder: (document: VaultDocument, indexes: number[], saveMode: ActionSaveMode) => Promise<void>
  onCompress: (document: VaultDocument, level: PdfCompressionLevel) => Promise<void>
  onInsert: (target: VaultDocument, source: VaultDocument, indexes: number[], at: number, saveMode: ActionSaveMode) => Promise<void>
  onClean: (document: VaultDocument, indexes: number[], saveMode: ActionSaveMode) => Promise<void>
  onAnalyse: (document: VaultDocument) => Promise<PageCleanupAnalysis>
  onRename: (documents: VaultDocument[], template: string) => Promise<void>
  onExportText: (document: VaultDocument, format: 'txt' | 'md') => Promise<void>
}

const ACTIONS: { id: ActionMode; icon: React.ReactNode; title: string; description: string }[] = [
  { id: 'combine', icon: <Files />, title: 'Combine PDFs', description: 'Join two or more documents in your chosen order' },
  { id: 'split', icon: <Copy />, title: 'Split or extract', description: 'Create a new document from selected pages' },
  { id: 'reorder', icon: <GripVertical />, title: 'Reorder pages', description: 'Arrange pages and save a new document' },
  { id: 'compress', icon: <Minimize2 />, title: 'Compress PDF', description: 'Download a smaller copy for sharing' },
  { id: 'insert', icon: <FilePlus2 />, title: 'Insert pages', description: 'Copy pages from one PDF into another' },
  { id: 'clean', icon: <Eraser />, title: 'Clean pages', description: 'Review blank and duplicate page suggestions' },
  { id: 'rename', icon: <PencilLine />, title: 'Batch rename', description: 'Rename several documents from a template' },
  { id: 'export', icon: <Download />, title: 'Export OCR text', description: 'Share recognised text as TXT or Markdown' },
]

export function ActionsScreen(props: ActionsScreenProps) {
  const { documents } = props
  const [mode, setMode] = useState<ActionMode | null>(null)
  return <>{mode ? <ActionWorkspace mode={mode} {...props} onBack={() => setMode(null)} /> : <>
    <header className="page-header"><div className="brand-mark"><SlidersHorizontal /></div><div><h1>Actions</h1><p>Organise and prepare PDFs locally</p></div></header>
    <section className="actions-intro"><strong>PDF tools without uploads</strong><span>Choose a task. Your originals remain unchanged unless an action clearly says otherwise.</span></section>
    <div className="action-hub-grid">{ACTIONS.map(action => <button key={action.id} onClick={() => setMode(action.id)}><span>{action.icon}</span><div><strong>{action.title}</strong><small>{action.description}</small></div><ChevronRight /></button>)}</div>
  </>}</>
}

function ActionWorkspace({ mode, documents, onBack, onCombine, onExtract, onReorder, onCompress, onInsert, onClean, onAnalyse, onRename, onExportText }: ActionsScreenProps & { mode: ActionMode; onBack: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [compression, setCompression] = useState<PdfCompressionLevel>('balanced')
  const chosen = selected.map(id => documents.find(document => document.id === id)).filter((document): document is VaultDocument => Boolean(document))
  const document = chosen[0]
  const title = ACTIONS.find(action => action.id === mode)!.title
  const multi = mode === 'combine' || mode === 'rename' || mode === 'insert'
  const toggle = (id: string) => setSelected(current => multi ? current.includes(id) ? current.filter(value => value !== id) : mode === 'insert' && current.length >= 2 ? current : [...current, id] : [id])
  const moveDocument = (id: string, offset: -1 | 1) => setSelected(current => { const index = current.indexOf(id), target = index + offset; if (index < 0 || target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try { await action(); if (mode === 'compress') setMessage('Compressed PDF saved to Downloads.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'This action could not be completed.') } finally { setBusy(false) } }
  if (document && mode === 'split') return <OperationShell title={title} onBack={() => setSelected([])}><PageExtractSheet document={document} initialPage={0} busy={busy} error={error} onClose={() => setSelected([])} onExtract={indexes => void run(() => onExtract(document, indexes))} /></OperationShell>
  if (document && mode === 'reorder') return <OperationShell title={title} onBack={() => setSelected([])}><ReorderPagesPanel document={document} busy={busy} error={error} onSave={(indexes, saveMode) => void run(() => onReorder(document, indexes, saveMode))} /></OperationShell>
  if (document && mode === 'compress') return <OperationShell title={title} onBack={() => setSelected([])}><CompressionSheet selected={compression} busy={busy} message={message} error={error} onSelect={setCompression} onClose={() => setSelected([])} onCompress={() => void run(() => onCompress(document, compression))} /></OperationShell>
  if (document && mode === 'clean') return <OperationShell title={title} onBack={() => setSelected([])}><CleanPagesPanel document={document} busy={busy} error={error} onAnalyse={onAnalyse} onSave={(indexes, saveMode) => void run(() => onClean(document, indexes, saveMode))} /></OperationShell>
  if (document && mode === 'export') return <OperationShell title={title} onBack={() => setSelected([])}><ExportTextPanel document={document} busy={busy} error={error} onExport={format => void run(() => onExportText(document, format))} /></OperationShell>
  if (mode === 'insert' && chosen.length === 2) return <OperationShell title={title} onBack={() => setSelected(current => current.slice(0, 1))}><InsertPagesPanel target={chosen[0]} source={chosen[1]} busy={busy} error={error} onSave={(indexes, at, saveMode) => void run(() => onInsert(chosen[0], chosen[1], indexes, at, saveMode))} /></OperationShell>
  return <section className="actions-workspace"><header><button onClick={onBack} aria-label="Back to actions"><ArrowLeft /></button><div><strong>{title}</strong><span>{mode === 'combine' ? 'Choose files in output order' : mode === 'insert' ? selected.length ? 'Step 2 of 3 · Choose the PDF supplying pages' : 'Step 1 of 3 · Choose the PDF receiving pages' : mode === 'rename' ? 'Choose all documents to rename' : 'Choose one document to continue'}</span></div></header>{mode === 'insert' ? <InsertRoleSummary target={chosen[0]} /> : null}<DocumentPicker mode={mode} documents={mode === 'insert' && chosen[0] ? documents.filter(item => item.id !== chosen[0].id) : documents} selected={selected} multi={multi} onToggle={toggle} />{mode === 'combine' && selected.length > 0 ? <div className="selected-document-tray"><strong>Output order</strong>{chosen.map((item, index) => <div key={item.id}><span>{index + 1}</span><b>{item.isPrivate ? 'Private document' : item.title}</b><button disabled={index === 0} onClick={() => moveDocument(item.id, -1)} aria-label="Move earlier"><ArrowUp /></button><button disabled={index === chosen.length - 1} onClick={() => moveDocument(item.id, 1)} aria-label="Move later"><ArrowDown /></button></div>)}</div> : null}{mode === 'rename' && chosen.length ? <RenamePanel documents={chosen} busy={busy} onRename={template => void run(() => onRename(chosen, template))} /> : null}{error ? <p className="sheet-error" role="alert">{error}</p> : null}{mode === 'combine' ? <button className="actions-run-button" disabled={busy || chosen.length < 2} onClick={() => void run(() => onCombine(chosen))}>{busy ? <span className="button-spinner" /> : <Files />} {busy ? 'Combining locally…' : `Combine ${chosen.length || ''} documents`}</button> : null}</section>
}

function InsertRoleSummary({ target }: { target?: VaultDocument }) {
  return <div className="insert-stepper"><span className="done">1</span><div><strong>Destination PDF</strong><small>{target ? `${target.isPrivate ? 'Private document' : target.title} · ${target.pages.length} pages` : 'Choose the PDF that will receive pages'}</small></div><span className={target ? 'active' : ''}>2</span><div><strong>Source PDF</strong><small>{target ? 'Now choose where the pages come from' : 'Next step'}</small></div><span>3</span><div><strong>Pages and position</strong><small>Preview before saving</small></div></div>
}

function DocumentPicker({ mode, documents, selected, multi, onToggle }: { mode: ActionMode; documents: VaultDocument[]; selected: string[]; multi: boolean; onToggle: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const initial = pickerPreferences()
  const [folder, setFolder] = useState(initial.folder)
  const [tag, setTag] = useState(initial.tag)
  const [type, setType] = useState(initial.type)
  const [privacy, setPrivacy] = useState<PrivacyFilter>(initial.privacy)
  const [date, setDate] = useState<DateFilter>(initial.date)
  const [sort, setSort] = useState<SortOrder>(initial.sort)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())
  const folders = useMemo(() => ['All folders', ...new Set(documents.map(document => document.folder))], [documents])
  const tags = useMemo(() => ['All tags', ...new Set(documents.flatMap(document => document.tags))], [documents])
  const types = useMemo(() => ['All types', ...new Set(documents.map(document => formatType(document.smartMetadata?.documentType)))], [documents])
  useEffect(() => {
    cachedPickerPreferences = { version: 1, folder, tag, type, privacy, date, sort }
    localStorage.setItem(PICKER_PREFERENCES_KEY, JSON.stringify(cachedPickerPreferences))
  }, [folder, tag, type, privacy, date, sort])
  useEffect(() => {
    let cancelled = false
    void Promise.all(documents.map(async document => [document.id, await documentStorageService.size(document)] as const)).then(entries => { if (!cancelled) setSizes(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [documents])
  const filtered = useMemo(() => {
    const now = Date.now(), cutoff = date === 'week' ? now - 7 * 864e5 : date === 'month' ? now - 31 * 864e5 : date === 'year' ? now - 366 * 864e5 : 0
    const matches = documents.filter(document => {
      if (folder !== 'All folders' && document.folder !== folder) return false
      if (tag !== 'All tags' && !document.tags.includes(tag)) return false
      if (type !== 'All types' && formatType(document.smartMetadata?.documentType) !== type) return false
      if (privacy !== 'all' && Boolean(document.isPrivate) !== (privacy === 'private')) return false
      if (cutoff && new Date(document.createdAt).getTime() < cutoff) return false
      if (!deferredQuery) return true
      const text = [document.title, document.folder, ...document.tags, ...document.pages.map(page => page.ocrText)].join(' ').toLocaleLowerCase()
      return text.includes(deferredQuery)
    })
    return matches.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'pages' ? b.pages.length - a.pages.length : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt))
  }, [documents, folder, tag, type, privacy, date, sort, deferredQuery])
  const clearFilters = () => { setFolder('All folders'); setTag('All tags'); setType('All types'); setPrivacy('all'); setDate('all'); setSort('recent') }
  const activeFilters = [folder !== 'All folders', tag !== 'All tags', type !== 'All types', privacy !== 'all', date !== 'all', sort !== 'recent'].filter(Boolean).length
  return <div className="action-picker">
    <div className="action-picker-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles or document text" aria-label="Search documents" />{query ? <button onClick={() => setQuery('')} aria-label="Clear search"><X /></button> : null}</div>
    <div className="action-picker-filter-bar"><button onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen}><SlidersHorizontal /> Filters{activeFilters ? ` (${activeFilters})` : ''}</button><span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>{activeFilters ? <button onClick={clearFilters}>Clear</button> : null}</div>
    {filtersOpen ? <div className="action-picker-filters advanced"><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}>{folders.map(value => <option key={value}>{value}</option>)}</select></label><label>Tag<select value={tag} onChange={event => setTag(event.target.value)}>{tags.map(value => <option key={value}>{value}</option>)}</select></label><label>Document type<select value={type} onChange={event => setType(event.target.value)}>{types.map(value => <option key={value}>{value}</option>)}</select></label><label>Privacy<select value={privacy} onChange={event => setPrivacy(event.target.value as PrivacyFilter)}><option value="all">All documents</option><option value="public">Not private</option><option value="private">Private only</option></select></label><label>Created<select value={date} onChange={event => setDate(event.target.value as DateFilter)}><option value="all">Any time</option><option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option></select></label><label>Sort by<select value={sort} onChange={event => setSort(event.target.value as SortOrder)}><option value="recent">Most recent</option><option value="oldest">Oldest first</option><option value="title">Title</option><option value="pages">Most pages</option></select></label></div> : null}
    <div className="action-picker-list">{filtered.map(document => {
      const index = selected.indexOf(document.id), unavailable = (mode === 'split' || mode === 'reorder' || mode === 'clean') && document.pages.length < 2, snippet = searchSnippet(document, deferredQuery)
      return <button key={document.id} className={index >= 0 ? 'selected' : ''} disabled={unavailable} onClick={() => onToggle(document.id)} aria-pressed={index >= 0}><span className="picker-thumb">{document.isPrivate ? <Lock /> : document.pages[0]?.thumbnailUrl || document.pages[0]?.imageUrl ? <img src={document.pages[0].thumbnailUrl || document.pages[0].imageUrl} alt="" /> : <FileText />}</span><span><strong>{document.isPrivate ? 'Private document' : document.title}</strong><small>{unavailable ? `Needs at least 2 pages for ${mode}` : `${document.folder} · ${document.pages.length} ${document.pages.length === 1 ? 'page' : 'pages'} · ${formatSize(sizes[document.id])}`}</small>{snippet && !document.isPrivate ? <em>{snippet}</em> : null}<b>{formatType(document.smartMetadata?.documentType)} · {document.status === 'indexed' ? 'Ready' : document.status === 'error' ? 'Needs attention' : 'Processing'}</b></span><i>{index >= 0 ? multi ? index + 1 : <Check /> : <ChevronRight />}</i></button>
    })}{filtered.length === 0 ? <p>No documents match these filters.</p> : null}</div>
  </div>
}

function ReorderPagesPanel({ document, busy, error, onSave }: { document: VaultDocument; busy: boolean; error: string; onSave: (indexes: number[], saveMode: ActionSaveMode) => void }) {
  const [order, setOrder] = useState(() => document.pages.map((_, index) => index))
  const [saveMode, setSaveMode] = useState<ActionSaveMode>('copy'), [confirmReplace, setConfirmReplace] = useState(false)
  const move = (position: number, offset: -1 | 1) => setOrder(current => { const target = position + offset; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[position], next[target]] = [next[target], next[position]]; return next })
  const submit = () => { if (saveMode === 'replace' && !confirmReplace) return setConfirmReplace(true); onSave(order, saveMode) }
  return <><header><div><strong>Reorder pages</strong><span>Arrange every page in its new position</span></div></header><div className="reorder-page-list">{order.map((pageIndex, position) => { const page = document.pages[pageIndex]; return <article key={page.id}><span>{position + 1}</span><img src={page.thumbnailUrl || page.imageUrl} alt={`Page ${pageIndex + 1}`} /><div><strong>Original page {pageIndex + 1}</strong><small>New position {position + 1}</small></div><button disabled={position === 0} onClick={() => move(position, -1)} aria-label="Move page earlier"><ArrowUp /></button><button disabled={position === order.length - 1} onClick={() => move(position, 1)} aria-label="Move page later"><ArrowDown /></button></article> })}</div><SaveModeChoice value={saveMode} onChange={value => { setSaveMode(value); setConfirmReplace(false) }} targetTitle={document.title} />{confirmReplace ? <ReplaceConfirmation title={document.title} onConfirm={submit} onCancel={() => setConfirmReplace(false)} /> : null}{error ? <p className="sheet-error" role="alert">{error}</p> : null}<button className="tool-primary" disabled={busy || confirmReplace || order.every((value, index) => value === index)} onClick={submit}>{busy ? <span className="button-spinner" /> : <GripVertical />} {busy ? 'Saving…' : saveMode === 'copy' ? 'Save reordered copy' : 'Replace existing PDF'}</button></>
}

function InsertPagesPanel({ target, source, busy, error, onSave }: { target: VaultDocument; source: VaultDocument; busy: boolean; error: string; onSave: (indexes: number[], at: number, saveMode: ActionSaveMode) => void }) {
  const [pages, setPages] = useState<number[]>([]), [at, setAt] = useState(target.pages.length)
  const [saveMode, setSaveMode] = useState<ActionSaveMode>('copy'), [confirmReplace, setConfirmReplace] = useState(false)
  const toggle = (index: number) => setPages(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index].sort((a, b) => a - b))
  const boundary = at === 0 ? 'before destination page 1' : at === target.pages.length ? `after destination page ${at}` : `between destination pages ${at} and ${at + 1}`
  const nearby = Array.from({ length: Math.min(5, target.pages.length) }, (_, offset) => Math.max(0, Math.min(target.pages.length - 1, at - 2 + offset))).filter((value, index, values) => values.indexOf(value) === index)
  const submit = () => { if (saveMode === 'replace' && !confirmReplace) { setConfirmReplace(true); return } onSave(pages, at, saveMode) }
  return <><div className="insert-final-step"><b>1 Destination</b><b>2 Source</b><b className="active">3 Pages and position</b></div><header><div><strong>Select source pages</strong><span>From {source.isPrivate ? 'private document' : source.title} · selected pages keep this order</span></div></header><div className="phase-four-pages source-pages">{source.pages.map((page, index) => <button key={page.id} className={pages.includes(index) ? 'selected' : ''} onClick={() => toggle(index)} aria-pressed={pages.includes(index)}><img src={page.thumbnailUrl || page.imageUrl} alt="" /><span>{pages.includes(index) ? `${pages.indexOf(index) + 1} · ` : ''}Page {index + 1}</span></button>)}</div><section className="insert-placement"><header><strong>Place {pages.length || 'selected'} page{pages.length === 1 ? '' : 's'} in destination</strong><span>{target.isPrivate ? 'Private document' : target.title} · {target.pages.length} pages</span></header><label>Insert after destination page<input type="number" min="0" max={target.pages.length} value={at} onChange={event => setAt(Math.max(0, Math.min(target.pages.length, Number(event.target.value))))} /><small>Use 0 to insert at the beginning</small></label><input className="insert-position-range" type="range" min="0" max={target.pages.length} value={at} onChange={event => setAt(Number(event.target.value))} aria-label="Insertion position" /><div className="destination-preview">{nearby.map(index => <div key={target.pages[index].id} className={index === at - 1 ? 'before' : index === at ? 'after' : ''}><img src={target.pages[index].thumbnailUrl || target.pages[index].imageUrl} alt="" /><span>Page {index + 1}</span></div>)}{pages.length ? <div className="inserted-block"><FilePlus2 /><strong>{pages.length} page{pages.length === 1 ? '' : 's'}</strong><span>insert here</span></div> : null}</div><p><strong>Result:</strong> {pages.length || 0} source page{pages.length === 1 ? '' : 's'} will be inserted {boundary}. The result will have {target.pages.length + pages.length} pages.</p></section><SaveModeChoice value={saveMode} onChange={value => { setSaveMode(value); setConfirmReplace(false) }} targetTitle={target.title} />{confirmReplace ? <div className="replace-confirm" role="alert"><strong>Replace “{target.title}”?</strong><span>The current version will be permanently replaced after the new version saves successfully. The source PDF is unchanged.</span><button onClick={submit}>Yes, replace it</button><button onClick={() => setConfirmReplace(false)}>Cancel</button></div> : null}{error ? <p className="sheet-error" role="alert">{error}</p> : null}<button className="tool-primary" disabled={busy || !pages.length || confirmReplace} onClick={submit}>{busy ? <span className="button-spinner" /> : <FilePlus2 />} {busy ? 'Saving…' : saveMode === 'copy' ? `Create ${target.pages.length + pages.length}-page copy` : 'Replace destination PDF'}</button></>
}

function CleanPagesPanel({ document, busy, error, onAnalyse, onSave }: { document: VaultDocument; busy: boolean; error: string; onAnalyse: (document: VaultDocument) => Promise<PageCleanupAnalysis>; onSave: (indexes: number[], saveMode: ActionSaveMode) => void }) {
  const [analysis, setAnalysis] = useState<PageCleanupAnalysis | null>(null), [selected, setSelected] = useState<number[]>([]), [analysisError, setAnalysisError] = useState('')
  const [saveMode, setSaveMode] = useState<ActionSaveMode>('copy'), [confirmReplace, setConfirmReplace] = useState(false)
  useEffect(() => { let active = true; void onAnalyse(document).then(result => { if (active) { setAnalysis(result); setSelected([...new Set([...result.blank, ...result.duplicates])]) } }).catch(cause => { if (active) setAnalysisError(cause instanceof Error ? cause.message : 'Pages could not be analysed.') }); return () => { active = false } }, [document, onAnalyse])
  const suggested = new Set([...(analysis?.blank ?? []), ...(analysis?.duplicates ?? [])])
  const submit = () => { if (saveMode === 'replace' && !confirmReplace) return setConfirmReplace(true); onSave(selected, saveMode) }
  return <><header><div><strong>Review cleanup suggestions</strong><span>Suggestions use completed on-device OCR; confirm every removal</span></div></header>{!analysis && !analysisError ? <p className="phase-four-note">Analysing locally…</p> : null}{analysis && !suggested.size ? <p className="phase-four-note">No confident blank or duplicate pages were found.</p> : null}<div className="phase-four-pages">{document.pages.map((page, index) => <button key={page.id} className={selected.includes(index) ? 'selected' : ''} onClick={() => setSelected(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index])} aria-pressed={selected.includes(index)}><img src={page.thumbnailUrl || page.imageUrl} alt="" /><span>Page {index + 1}{analysis?.blank.includes(index) ? ' · Blank?' : analysis?.duplicates.includes(index) ? ' · Duplicate?' : ''}</span></button>)}</div><SaveModeChoice value={saveMode} onChange={value => { setSaveMode(value); setConfirmReplace(false) }} targetTitle={document.title} />{confirmReplace ? <ReplaceConfirmation title={document.title} onConfirm={submit} onCancel={() => setConfirmReplace(false)} /> : null}{analysisError || error ? <p className="sheet-error" role="alert">{analysisError || error}</p> : null}<button className="tool-primary" disabled={busy || confirmReplace || !selected.length || selected.length === document.pages.length} onClick={submit}>{busy ? <span className="button-spinner" /> : <Eraser />} {busy ? 'Saving…' : saveMode === 'copy' ? `Create cleaned copy` : `Replace existing PDF`}</button></>
}

function ReplaceConfirmation({ title, onConfirm, onCancel }: { title: string; onConfirm: () => void; onCancel: () => void }) {
  return <div className="replace-confirm" role="alert"><strong>Replace “{title}”?</strong><span>The current version will be permanently replaced only after the new version saves successfully.</span><button onClick={onConfirm}>Yes, replace it</button><button onClick={onCancel}>Cancel</button></div>
}

function SaveModeChoice({ value, onChange, targetTitle }: { value: ActionSaveMode; onChange: (value: ActionSaveMode) => void; targetTitle: string }) {
  return <fieldset className="save-mode-choice"><legend>Save result</legend><button className={value === 'copy' ? 'selected' : ''} onClick={() => onChange('copy')} aria-pressed={value === 'copy'}><Copy /><span><strong>Create a copy</strong><small>Keep “{targetTitle}” unchanged</small></span><Check /></button><button className={value === 'replace' ? 'selected danger' : 'danger'} onClick={() => onChange('replace')} aria-pressed={value === 'replace'}><Eraser /><span><strong>Replace existing PDF</strong><small>Keep its name, folder and tags</small></span><Check /></button></fieldset>
}

function RenamePanel({ documents, busy, onRename }: { documents: VaultDocument[]; busy: boolean; onRename: (template: string) => void }) {
  const [template, setTemplate] = useState('{date} - {title}')
  return <div className="phase-four-panel"><label className="phase-four-field">Naming template<input value={template} onChange={event => setTemplate(event.target.value)} placeholder="{date} - {title} - {n}" /></label><small>Tokens: {'{title}'} {'{n}'} {'{date}'} {'{type}'}</small><strong>Preview: {template.replaceAll('{title}', documents[0].isPrivate ? 'Private document' : documents[0].title).replaceAll('{n}', '01').replaceAll('{date}', new Date().toISOString().slice(0, 10)).replaceAll('{type}', documents[0].smartMetadata?.documentType || 'document')}</strong><button className="actions-run-button" disabled={busy || !template.trim()} onClick={() => onRename(template)}><PencilLine /> {busy ? 'Renaming locally…' : `Rename ${documents.length} documents`}</button></div>
}

function ExportTextPanel({ document, busy, error, onExport }: { document: VaultDocument; busy: boolean; error: string; onExport: (format: 'txt' | 'md') => void }) {
  const searchable = document.pages.filter(page => page.ocrText.trim()).length
  return <><header><div><strong>Export recognised text</strong><span>{searchable} of {document.pages.length} pages contain searchable text</span></div></header><p className="phase-four-note">Pages without recognised text are clearly marked in the export. Nothing is uploaded.</p>{error ? <p className="sheet-error" role="alert">{error}</p> : null}<div className="phase-four-export"><button disabled={busy} onClick={() => onExport('txt')}><FileText /><strong>Plain text</strong><span>.txt</span></button><button disabled={busy} onClick={() => onExport('md')}><FileText /><strong>Markdown</strong><span>.md</span></button></div></>
}

function OperationShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return <section className="actions-operation"><div className="actions-operation-back"><button onClick={onBack}><ArrowLeft /> Choose another document</button><span>{title}</span></div><div className="actions-operation-card">{children}</div></section>
}
