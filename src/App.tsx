import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArrowLeft, Camera, Check, ChevronRight, Clock3, Crop, Download, FileText, Folder, FolderOpen,
  Home, ImagePlus, LockKeyhole, MoreHorizontal, RotateCw, ScanLine, Search, Settings, ShieldCheck, ChevronDown, ChevronUp,
  Share2, Trash2, Upload, X, PauseCircle, RefreshCw,
} from 'lucide-react'
import type { DocumentPage, Screen, VaultDocument } from './domain/types'
import { documentsRepository } from './services/documentRepository'
import { cancelProcessing, processDocument, resumePendingProcessing, retryProcessing } from './services/processingQueue'
import { filesToPages } from './services/scannerService'
import { exportPdf } from './services/pdfService'
import { ScanPageEditor } from './features/scanner/components/ScanPageEditor'
import { ScannerLab } from './features/scanner/components/ScannerLab'
import { documentStorageService } from './services/documentStorageService'
import { searchService, pageMatches, type DocumentSearchResult } from './services/searchService'
import { ZoomablePage } from './features/viewer/components/ZoomablePage'
import { checkDocumentStorage } from './services/storageHealthService'

const formatDate = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
const statusLabel = (doc: VaultDocument) => {
  if (doc.status === 'indexed') return 'Searchable'
  if (doc.status === 'error') return 'Needs attention'
  const done = doc.pages.filter(page => page.ocrState === 'complete').length
  return done ? `Indexing ${done} of ${doc.pages.length}` : 'Preparing searchable text'
}

function App() {
  const [screen, setScreen] = useState<Screen>(() => import.meta.env.DEV && new URLSearchParams(window.location.search).has('scanner-lab') ? { name: 'scanner-lab' } : { name: 'home' })
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])

  const refresh = async () => { const results = await searchService.search(query); setSearchResults(results); setDocuments(results.map(result => result.document)); setLoading(false) }
  useEffect(() => { void refresh() }, [query])

  const updateDocument = useCallback((updated: VaultDocument) => setDocuments(current => current.map(item => item.id === updated.id ? { ...updated } : item)), [])
  useEffect(() => {
    void resumePendingProcessing(updateDocument)
    const resume = () => { if (document.visibilityState === 'visible') void resumePendingProcessing(updateDocument) }
    document.addEventListener('visibilitychange', resume)
    return () => document.removeEventListener('visibilitychange', resume)
  }, [updateDocument])
  const open = (next: Screen) => { setScreen(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (screen.name === 'capture') return <CaptureScreen onClose={() => open({ name: 'home' })} onSave={async doc => {
    await documentsRepository.save(doc)
    setDocuments(current => [doc, ...current])
    open({ name: 'viewer', id: doc.id })
    void processDocument(doc.id, updateDocument)
  }} />
  if (screen.name === 'scanner-lab') return <ScannerLab onBack={() => open({ name: 'settings' })} />

  if (screen.name === 'viewer') {
    const document = documents.find(item => item.id === screen.id)
    return document ? <Viewer document={document} initialPage={screen.page} initialQuery={screen.query} onBack={() => open({ name: 'home' })} onChange={async updated => { await documentsRepository.save(updated); updateDocument(updated) }} onDelete={async () => { await documentsRepository.remove(screen.id); await refresh(); open({ name: 'home' }) }} /> : <EmptyLoading />
  }

  return <div className="app-shell">
    <main className="content">
      {screen.name === 'home' && <Library documents={documents} searchResults={searchResults} query={query} setQuery={setQuery} loading={loading} onScan={() => open({ name: 'capture' })} onOpen={(id, page) => open({ name: 'viewer', id, page, query })} />}
      {screen.name === 'folders' && <Folders documents={documents} onOpen={id => open({ name: 'viewer', id })} />}
      {screen.name === 'settings' && <SettingsScreen onOpenScannerLab={() => open({ name: 'scanner-lab' })} />}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation">
      <NavButton active={screen.name === 'home'} icon={<Home />} label="Library" onClick={() => open({ name: 'home' })} />
      <NavButton active={screen.name === 'folders'} icon={<Folder />} label="Folders" onClick={() => open({ name: 'folders' })} />
      <button className="nav-tab scan-tab" onClick={() => open({ name: 'capture' })} aria-label="Scan document"><span className="nav-icon"><ScanLine /></span><span className="nav-label">Scan</span></button>
      <NavButton active={screen.name === 'settings'} icon={<Settings />} label="Settings" onClick={() => open({ name: 'settings' })} />
    </nav>
  </div>
}

function Library({ documents, searchResults, query, setQuery, loading, onScan, onOpen }: { documents: VaultDocument[]; searchResults: DocumentSearchResult[]; query: string; setQuery: (value: string) => void; loading: boolean; onScan: () => void; onOpen: (id: string, page?: number) => void }) {
  return <>
    <header className="home-header">
      <div className="brand-mark"><Archive size={22} /></div>
      <div><h1>LOCAL</h1><p>Local OCR, Capture, Archive &amp; Lookup</p></div>
      <div className="privacy-chip"><ShieldCheck size={15} /> On-device</div>
    </header>
    <section className="hero">
      <div className="eyebrow">Your private document cabinet</div>
      <h2>Find any paper,<br /><em>right when you need it.</em></h2>
      <p>Scan, organise and search every document. Nothing leaves this device.</p>
      <button className="primary-button" onClick={onScan}><Camera /><span>Scan a document</span></button>
    </section>
    <div className="search-field"><Search size={20} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles, folders or document text" aria-label="Search documents" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={18} /></button>}</div>
    <section className="section-block">
      <div className="section-heading"><div><span>{query ? 'Search results' : 'Recent documents'}</span><small>{documents.length} {documents.length === 1 ? 'document' : 'documents'}</small></div></div>
      {loading ? <EmptyLoading /> : documents.length ? <div className="document-list">{documents.map(document => { const match = searchResults.find(result => result.document.id === document.id)?.pageMatches[0]; return <DocumentRow key={document.id} document={document} match={match} onClick={() => onOpen(document.id, match?.pageIndex)} /> })}</div> : <EmptyLibrary onScan={onScan} searching={Boolean(query)} />}
    </section>
    <div className="privacy-note"><LockKeyhole size={18} /><div><strong>Private by design</strong><span>Your files and searches stay entirely on this device.</span></div></div>
  </>
}

function DocumentRow({ document, match, onClick }: { document: VaultDocument; match?: DocumentSearchResult['pageMatches'][number]; onClick: () => void }) {
  return <button className="document-row" onClick={onClick}>
    {match && <span className="match-page-badge">Page {match.pageIndex + 1}</span>}
    <div className="doc-thumb">{document.pages[0]?.thumbnailUrl || document.pages[0]?.imageUrl ? <img src={document.pages[0].thumbnailUrl || document.pages[0].imageUrl} alt="" /> : <FileText />}</div>
    <div className="doc-main"><strong>{document.title}</strong><span>{formatDate(document.createdAt)} · {document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'}</span><small className={document.status === 'error' ? 'status error' : 'status'}><i />{statusLabel(document)}</small></div>
    <ChevronRight className="row-arrow" size={20} />
  </button>
}

function EmptyLibrary({ onScan, searching }: { onScan: () => void; searching: boolean }) {
  return <div className="empty-state"><div><FileText /></div><h3>{searching ? 'No matching documents' : 'Your cabinet is empty'}</h3><p>{searching ? 'Try another word or phrase.' : 'Scan your first document to make it searchable and easy to find.'}</p>{!searching && <button className="secondary-button" onClick={onScan}><Camera size={18} /> Scan now</button>}</div>
}

function CaptureScreen({ onClose, onSave }: { onClose: () => void; onSave: (doc: VaultDocument) => Promise<void> }) {
  const [pages, setPages] = useState<DocumentPage[]>([])
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState('Unfiled')
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setProcessing(true); setCaptureError('')
    try {
      const addedPages = await filesToPages(files)
      setPages(current => [...current, ...addedPages])
    } catch {
      setCaptureError('One or more pages could not be processed. Please try capturing them again.')
    } finally { setProcessing(false) }
  }
  const rotate = (id: string) => setPages(current => current.map(page => page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page))
  const movePage = (index: number, direction: -1 | 1) => setPages(current => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const reordered = [...current]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    return reordered
  })
  const save = async () => {
    const now = new Date().toISOString()
    setSaving(true); setCaptureError('')
    try {
      const storage = await checkDocumentStorage(pages)
      if (!storage.ok) { setCaptureError(storage.message || 'Not enough free storage to save this document.'); setSaving(false); return }
      await onSave({ id: crypto.randomUUID(), title: title.trim() || `Scanned document · ${formatDate(now)}`, folder, createdAt: now, updatedAt: now, status: 'ocr_pending', pages, tags: [] })
    }
    catch { setCaptureError('This document could not be saved. Check available device storage and try again.'); setSaving(false) }
  }
  const editingPage = pages.find(page => page.id === editingPageId)
  if (editingPage) return <ScanPageEditor page={editingPage} pageNumber={pages.indexOf(editingPage) + 1} onCancel={() => setEditingPageId(null)} onSave={updated => { setPages(current => current.map(page => page.id === updated.id ? updated : page)); setEditingPageId(null) }} />

  return <div className="full-screen">
    <header className="top-bar"><button onClick={onClose} aria-label="Cancel"><X /></button><div><strong>New scan</strong><span>{saving ? 'Saving safely on this device…' : processing ? 'Finding document edges…' : pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} captured` : 'Add your pages'}</span></div><button className="text-action" disabled={!pages.length || processing || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></header>
    {!pages.length ? <section className="capture-empty">
      <div className="viewfinder"><span /><span /><span /><span /><FileText /></div>
      <h2>Ready to scan</h2><p>Place the document on a flat surface with good lighting.</p>
      <button className="primary-button" onClick={() => cameraRef.current?.click()}><Camera /> Open camera</button>
      <button className="secondary-button" onClick={() => inputRef.current?.click()}><Upload /> Import photos</button>
    </section> : <>
      <section className="scan-form"><label>Document title<input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Office memorandum" autoFocus /></label><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option>Unfiled</option><option>Office</option><option>Personal</option><option>Receipts</option><option>Legal</option></select></label></section>
      <section className="page-grid">{pages.map((page, index) => <article className="page-card" key={page.id}><button className="page-image" onClick={() => setEditingPageId(page.id)} aria-label={`Edit crop and enhancement for page ${index + 1}`}><img src={page.imageUrl} alt={`Page ${index + 1}`} style={{ transform: `rotate(${page.rotation}deg)` }} /><span>{index + 1}</span>{page.processingState === 'needs_review' && <small>Check crop</small>}</button><div className="page-meta"><span>{page.renderPreset === 'black-white' ? 'B&W' : page.renderPreset === 'grayscale' ? 'Grayscale' : 'Clean Colour'}</span><button onClick={() => setEditingPageId(page.id)} aria-label={`Edit page ${index + 1}`}><Crop /></button><button onClick={() => rotate(page.id)} aria-label={`Rotate page ${index + 1}`}><RotateCw /></button><button onClick={() => movePage(index, -1)} disabled={index === 0} aria-label={`Move page ${index + 1} earlier`}><ArrowLeft /></button><button onClick={() => movePage(index, 1)} disabled={index === pages.length - 1} aria-label={`Move page ${index + 1} later`}><ChevronRight /></button><button onClick={() => setPages(current => current.filter(item => item.id !== page.id))} aria-label={`Delete page ${index + 1}`}><Trash2 /></button></div></article>)}</section>
      {processing && <div className="page-processing"><span className="button-spinner" /> Processing each page on this device…</div>}
      {captureError && <div className="scanner-error" role="alert">{captureError}</div>}
      <button className="add-page" onClick={() => cameraRef.current?.click()} disabled={processing}><ImagePlus /> Add another page</button>
    </>}
    <input ref={cameraRef} className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={event => void addFiles(event.target.files)} />
    <input ref={inputRef} className="hidden-input" type="file" accept="image/*" multiple onChange={event => void addFiles(event.target.files)} />
  </div>
}

function Viewer({ document, initialPage = 0, initialQuery = '', onBack, onChange, onDelete }: { document: VaultDocument; initialPage?: number; initialQuery?: string; onBack: () => void; onChange: (doc: VaultDocument) => void; onDelete: () => void }) {
  const [page, setPage] = useState(Math.min(Math.max(initialPage, 0), Math.max(0, document.pages.length - 1)))
  const [editing, setEditing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(Boolean(initialQuery))
  const [withinQuery, setWithinQuery] = useState(initialQuery)
  const [title, setTitle] = useState(document.title)
  const [exportState, setExportState] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [jobAction, setJobAction] = useState<'idle' | 'working'>('idle')
  const current = document.pages[page]
  const matches = useMemo(() => pageMatches(document, withinQuery), [document, withinQuery])
  const activeMatch = matches.findIndex(match => match.pageIndex === page)
  const moveMatch = (direction: -1 | 1) => {
    if (!matches.length) return
    const next = activeMatch < 0 ? 0 : (activeMatch + direction + matches.length) % matches.length
    setPage(matches[next].pageIndex)
  }
  const saveTitle = () => { const trimmed = title.trim(); if (trimmed) onChange({ ...document, title: trimmed, updatedAt: new Date().toISOString() }); setEditing(false) }
  const downloadPdf = async () => {
    setExportState('working')
    try {
      const exported = await exportPdf(document)
      if (exported !== document) onChange(exported)
      setExportState('success')
      setTimeout(() => setExportState('idle'), 3000)
    } catch (error) {
      console.error(error)
      setExportState('error')
    }
  }
  return <div className="full-screen viewer-screen">
    <header className="top-bar"><button onClick={onBack} aria-label="Back"><ArrowLeft /></button><div>{editing ? <input className="title-edit" value={title} onChange={event => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={event => event.key === 'Enter' && saveTitle()} autoFocus /> : <><strong>{document.title}</strong><span>{document.folder} · {document.pages.length} pages</span></>}</div><button onClick={() => setEditing(true)} aria-label="More actions"><MoreHorizontal /></button></header>
    <div className={`processing-banner ${document.status === 'error' ? 'has-error' : ''}`}><Clock3 size={17} /><span>{statusLabel(document)}</span>{document.status === 'indexed' && <Check size={17} />}{(document.status === 'ocr_pending' || document.status === 'ocr_processing') && <button disabled={jobAction === 'working'} onClick={() => { setJobAction('working'); void cancelProcessing(document.id, updated => { onChange(updated); setJobAction('idle') }) }}><PauseCircle /> Pause</button>}{(document.status === 'error' || document.status === 'saved') && document.pages.some(item => item.ocrState !== 'complete') && <button disabled={jobAction === 'working'} onClick={() => { setJobAction('working'); void retryProcessing(document.id, updated => { onChange(updated); if (updated.status === 'indexed' || updated.status === 'error') setJobAction('idle') }) }}><RefreshCw /> Retry OCR</button>}<button onClick={() => setSearchOpen(open => !open)}><Search /> Search text</button></div>
    {searchOpen && <div className="viewer-search"><Search /><input value={withinQuery} onChange={event => setWithinQuery(event.target.value)} placeholder="Search this document" aria-label="Search this document" autoFocus /><span>{withinQuery ? matches.length ? `${Math.max(1, activeMatch + 1)}/${matches.length}` : '0' : ''}</span><button onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="Previous match"><ChevronUp /></button><button onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="Next match"><ChevronDown /></button><button onClick={() => { setWithinQuery(''); setSearchOpen(false) }} aria-label="Close search"><X /></button></div>}
    <section className="document-canvas">{current && <ZoomablePage key={current.id} src={current.imageUrl} alt={`Page ${page + 1}`} rotation={current.rotation} />}{activeMatch >= 0 && <div className="viewer-match"><b>Page {page + 1}</b><span>{matches[activeMatch].snippet}</span></div>}</section>
    <section className="thumbnail-strip" aria-label="Pages">{document.pages.map((item, index) => <button key={item.id} className={index === page ? 'active' : ''} onClick={() => setPage(index)}><img src={item.imageUrl} alt={`Page ${index + 1}`} /><span>{index + 1}</span></button>)}</section>
    <footer className="viewer-actions">
      <button className="export-action" onClick={() => void downloadPdf()} disabled={exportState === 'working'}>{exportState === 'working' ? <span className="button-spinner" /> : exportState === 'success' ? <Check /> : <Download />}<span>{exportState === 'working' ? 'Creating PDF…' : exportState === 'success' ? 'PDF ready' : 'Download PDF'}</span></button>
      <div className="minor-actions"><button onClick={() => setEditing(true)}><FileText /> Rename</button><button onClick={() => void downloadPdf()}><Share2 /> Share</button><button onClick={() => { if (confirm('Delete this document from this device?')) onDelete() }} className="danger"><Trash2 /> Delete</button></div>
      {exportState === 'error' && <p className="export-error">Could not create this PDF. Check that every scanned page can be opened, then try again.</p>}
    </footer>
  </div>
}

function Folders({ documents, onOpen }: { documents: VaultDocument[]; onOpen: (id: string) => void }) {
  const grouped = useMemo(() => Object.entries(documents.reduce<Record<string, VaultDocument[]>>((folders, document) => {
    ;(folders[document.folder] ??= []).push(document)
    return folders
  }, {})), [documents])
  const [selected, setSelected] = useState<string | null>(null)
  const visible = selected ? documents.filter(document => document.folder === selected) : []
  return <><PageHeader icon={<FolderOpen />} title="Folders" subtitle="Keep related papers together" />{selected ? <section className="section-block"><button className="inline-back" onClick={() => setSelected(null)}><ArrowLeft /> All folders</button><div className="section-heading"><div><span>{selected}</span><small>{visible.length} documents</small></div></div><div className="document-list">{visible.map(document => <DocumentRow key={document.id} document={document} onClick={() => onOpen(document.id)} />)}</div></section> : grouped.length ? <div className="folder-grid">{grouped.map(([name, docs]) => <button key={name} onClick={() => setSelected(name)}><Folder /><strong>{name}</strong><span>{docs.length} documents</span><ChevronRight /></button>)}</div> : <div className="empty-state"><div><Folder /></div><h3>No folders yet</h3><p>Folders appear here when you organise a scanned document.</p></div>}</>
}

function SettingsScreen({ onOpenScannerLab }: { onOpenScannerLab: () => void }) {
  const rows = [['Document storage', documentStorageService.usesNativeFiles() ? 'Private app files' : 'Browser test storage'], ['OCR processing', 'This device'], ['Search indexing', 'This device'], ['Cloud synchronisation', 'Not enabled'], ['Analytics', 'None']]
  return <><PageHeader icon={<Settings />} title="Settings" subtitle="Privacy and local storage" /><section className="privacy-card"><div className="shield"><ShieldCheck /></div><div><h2>Private by design</h2><p>Documents stay on this device. OCR and search indexing run locally. No document data is uploaded.</p></div></section><button className="scanner-lab-entry" onClick={onOpenScannerLab}><span><ScanLine /></span><div><strong>Scanner Lab</strong><small>Compare processing on a test document</small></div><ChevronRight /></button><section className="settings-list"><h3>Privacy status</h3>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong><i />{value}</strong></div>)}</section><section className="about-card"><span>LOCAL</span><small>Version 0.1.0</small><p>A quiet, private home for your important papers.</p></section></>
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) { return <header className="page-header"><div className="brand-mark">{icon}</div><div><h1>{title}</h1><p>{subtitle}</p></div></header> }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={`nav-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span></button> }
function EmptyLoading() { return <div className="loading-state"><span /><span /><span /></div> }

export default App
