import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Archive, ArrowLeft, Camera, Check, ChevronRight, CircleHelp, Clock3, Copy, Crop, Download, ExternalLink, FileText, FileUp, Files, Folder, FolderOpen,
  GripVertical, Home, ImagePlus, LockKeyhole, MoreHorizontal, RotateCw, ScanLine, Search, Settings, ShieldCheck, ChevronDown, ChevronUp,
  Share2, Tag, Trash2, Upload, X, PauseCircle, RefreshCw, Pencil, Lock, Minimize2, Unlock,
} from 'lucide-react'
import type { DocumentPage, Screen, VaultDocument } from './domain/types'
import { documentsRepository } from './services/documentRepository'
import { cancelProcessing, processDocument, resumePendingProcessing, retryProcessing } from './services/processingQueue'
import { filesToPages, nativeScansToPages } from './services/scannerService'
import { downloadCompressedPdf, downloadPdf as downloadPdfFile, openDownloadedPdf, passwordProtectPdf, removePdfPassword, sharePdf as sharePdfFile, type PdfCompressionLevel } from './services/pdfService'
import { ScanPageEditor } from './features/scanner/components/ScanPageEditor'
import { ScannerLab } from './features/scanner/components/ScannerLab'
import { documentStorageService } from './services/documentStorageService'
import { searchService, pageMatches, parseAdvancedQuery, type DocumentSearchResult, type SmartSearchFilter } from './services/searchService'
import { ZoomablePage } from './features/viewer/components/ZoomablePage'
import { checkDocumentStorage } from './services/storageHealthService'
import { InAppCamera } from './features/scanner/components/InAppCamera'
import { NativeDocumentScanner } from './features/scanner/components/NativeDocumentScanner'
import { nativeDocumentScannerService } from './services/nativeDocumentScannerService'
import { processPageImages } from './features/scanner/services/scannerProcessingService'
import { defaultAdjustments } from './features/scanner/processing/renderPresets'
import { defaultCorners } from './features/scanner/processing/edgeDetection'
import { backgroundProcessingService } from './services/backgroundProcessingService'
import { backupService } from './services/backupService'
import { appLockService } from './services/appLockService'
import { pdfImportService } from './services/pdfImportService'
import { combineDocuments, extractPages } from './services/documentOperationsService'
import { CombineDocumentsSheet } from './features/library/components/CombineDocumentsSheet'
import { PageExtractSheet } from './features/viewer/components/PageExtractSheet'
import { CompressionSheet } from './features/viewer/components/CompressionSheet'
import { TagEditorSheet } from './features/viewer/components/TagEditorSheet'
import { BulkActionBar, BulkOrganizeSheet, type BulkEditMode } from './features/library/components/BulkDocumentTools'
import { StorageSecurityPanel } from './features/settings/components/StorageSecurityPanel'
import { screenSecurityService } from './services/screenSecurityService'
import { privateStorageService } from './services/privateStorageService'

const formatDate = (value: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
const statusLabel = (doc: VaultDocument) => {
  if (doc.status === 'indexed') return 'Searchable'
  if (doc.status === 'error') { if (doc.processingStage === 'pdf') return 'Searchable PDF needs retry'; const failed = doc.pages.filter(page => page.ocrState === 'error').length; return `${failed || 1} ${failed === 1 ? 'page needs' : 'pages need'} OCR retry` }
  if (doc.processingStage === 'pdf') return 'Creating searchable PDF'
  if (doc.processingStage === 'indexing') return 'Indexing document'
  const done = doc.pages.filter(page => page.ocrState === 'complete').length
  return done ? `Indexing ${done} of ${doc.pages.length}` : 'Preparing searchable text'
}

function App() {
  const [screen, setScreen] = useState<Screen>(() => import.meta.env.DEV && new URLSearchParams(window.location.search).has('scanner-lab') ? { name: 'scanner-lab' } : { name: 'home' })
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])
  const [searchFilter, setSearchFilter] = useState<SmartSearchFilter>('all')
  const deferredQuery = useDeferredValue(query)
  const [lockState, setLockState] = useState<'checking' | 'locked' | 'unlocked'>('checking')
  const hiddenAt = useRef(0)
  const unlocking = useRef(false)

  useEffect(() => { void privateStorageService.clearAllSessions() }, [])
  const unlock = useCallback(async () => { if (unlocking.current) return; unlocking.current = true; try { await appLockService.authenticate(); setLockState('unlocked') } catch { setLockState('locked') } finally { unlocking.current = false } }, [])
  useEffect(() => { if (!appLockService.enabled()) setLockState('unlocked'); else void unlock() }, [unlock])
  useEffect(() => {
    const protect = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else if (appLockService.enabled() && hiddenAt.current && Date.now() - hiddenAt.current > 30_000) setLockState('locked')
    }
    document.addEventListener('visibilitychange', protect)
    return () => document.removeEventListener('visibilitychange', protect)
  }, [])

  const refresh = async () => {
    const results = await searchService.search(deferredQuery, searchFilter)
    const allDocuments = deferredQuery || searchFilter !== 'all' ? await documentsRepository.list() : results.map(result => result.document)
    setSearchResults(results); setDocuments(allDocuments); setLoading(false)
  }
  useEffect(() => { setLoading(true); void refresh() }, [deferredQuery, searchFilter])

  const updateDocument = useCallback((updated: VaultDocument) => { setDocuments(current => current.map(item => item.id === updated.id ? { ...updated } : item)); setSearchResults(current => current.map(result => result.document.id === updated.id ? { ...result, document: { ...updated } } : result)) }, [])
  useEffect(() => {
    void resumePendingProcessing(updateDocument)
    const resume = () => { if (document.visibilityState === 'visible') void resumePendingProcessing(updateDocument) }
    document.addEventListener('visibilitychange', resume)
    let disposed = false
    let removeNativeListener = () => {}
    void backgroundProcessingService.onChange((_documentId, state) => {
      if (state === 'running' || state === 'succeeded' || state === 'failed') void resumePendingProcessing(updateDocument)
    }).then(remove => { if (disposed) remove(); else removeNativeListener = remove })
    return () => { disposed = true; document.removeEventListener('visibilitychange', resume); removeNativeListener() }
  }, [updateDocument])
  const open = (next: Screen) => { setScreen(next); if (next.name === 'home') void refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const openDocument = async (id: string, page?: number, documentQuery?: string) => {
    const target = documents.find(item => item.id === id) ?? await documentsRepository.get(id)
    if (target?.isPrivate) {
      try { await appLockService.authenticate() }
      catch { return }
      const revealed = await documentsRepository.reveal(id)
      if (revealed) updateDocument(revealed)
    }
    open({ name: 'viewer', id, page, query: documentQuery })
  }
  const saveNewDocument = async (doc: VaultDocument) => {
    await documentsRepository.save(doc)
    setDocuments(current => [doc, ...current.filter(item => item.id !== doc.id)])
    setSearchResults(current => [{ document: doc, score: 0, pageMatches: [] }, ...current.filter(result => result.document.id !== doc.id)])
    open({ name: 'viewer', id: doc.id })
    window.setTimeout(() => void processDocument(doc.id, updateDocument).catch(async error => {
      console.error('[processing] Deferred document processing failed', error)
      const latest = await documentsRepository.get(doc.id)
      if (latest) updateDocument(latest)
    }), 0)
  }
  const importPdf = async () => {
    const imported = await pdfImportService.pick()
    if (imported.cancelled) return
    const now = new Date().toISOString()
    await saveNewDocument({ id: crypto.randomUUID(), title: imported.title, titleSource: 'manual', folder: 'Unfiled', createdAt: now, updatedAt: now, status: 'ocr_pending', processingStage: 'ocr', pages: imported.pages, tags: [] })
  }
  const combineSelectedDocuments = async (selected: VaultDocument[]) => {
    if (selected.some(document => document.isPrivate)) await appLockService.authenticate()
    await saveNewDocument(await combineDocuments(selected))
  }
  const bulkUpdateDocuments = async (ids: string[], action: { type: 'move' | 'tag' | 'privacy'; value: string | boolean }) => {
    const selectedIds = new Set(ids)
    const selected = documents.filter(document => selectedIds.has(document.id))
    if (action.type === 'privacy') await appLockService.authenticate()
    const now = new Date().toISOString()
    const updated = selected.map(document => action.type === 'move'
      ? { ...document, folder: String(action.value), updatedAt: now }
      : action.type === 'tag'
        ? { ...document, tags: document.tags.some(tag => tag.toLocaleLowerCase() === String(action.value).toLocaleLowerCase()) ? document.tags : [...document.tags, String(action.value)], updatedAt: now }
        : { ...document, isPrivate: Boolean(action.value), updatedAt: now })
    await Promise.all(updated.map(document => documentsRepository.save(document)))
    const updates = new Map(updated.map(document => [document.id, document]))
    setDocuments(current => current.map(document => updates.get(document.id) ?? document))
    setSearchResults(current => current.map(result => updates.has(result.document.id) ? { ...result, document: updates.get(result.document.id)! } : result))
  }
  const bulkDeleteDocuments = async (ids: string[]) => {
    await Promise.all(ids.map(id => documentsRepository.remove(id)))
    const deleted = new Set(ids)
    setDocuments(current => current.filter(document => !deleted.has(document.id)))
    setSearchResults(current => current.filter(result => !deleted.has(result.document.id)))
  }

  if (lockState !== 'unlocked') return <AppLockScreen checking={lockState === 'checking'} onUnlock={() => void unlock()} />

  if (screen.name === 'capture') return <CaptureScreen onClose={() => open({ name: 'home' })} onSave={saveNewDocument} />
  if (screen.name === 'scanner-lab') return <ScannerLab onBack={() => open({ name: 'settings' })} />

  if (screen.name === 'viewer') {
    const document = documents.find(item => item.id === screen.id)
    return document ? <Viewer document={document} initialPage={screen.page} initialQuery={screen.query} onBack={() => open({ name: 'home' })} onChange={async updated => {
      const previousSession = updated.privateSessionId
      await documentsRepository.save(updated)
      const visible = updated.isPrivate
        ? await documentsRepository.reveal(updated.id) ?? updated
        : await documentStorageService.hydrate({ ...updated, privateSessionId: undefined, privatePdfPath: undefined })
      if (previousSession && previousSession !== visible.privateSessionId) await privateStorageService.clearSession(previousSession)
      updateDocument(visible)
    }} onCreate={saveNewDocument} onDelete={async () => { await documentsRepository.remove(screen.id); await refresh(); open({ name: 'home' }) }} /> : <EmptyLoading />
  }

  return <div className="app-shell">
    <main className="content">
      {screen.name === 'home' && <Library documents={searchResults.map(result => result.document)} searchResults={searchResults} query={query} setQuery={setQuery} searchFilter={searchFilter} setSearchFilter={setSearchFilter} loading={loading} onScan={() => open({ name: 'capture' })} onImport={importPdf} onCombine={combineSelectedDocuments} onBulkUpdate={bulkUpdateDocuments} onBulkDelete={bulkDeleteDocuments} onOpen={(id, page) => void openDocument(id, page, parseAdvancedQuery(query).text)} />}
      {screen.name === 'folders' && <Folders documents={documents} onOpen={id => void openDocument(id)} />}
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

const SEARCH_FILTERS: { id: SmartSearchFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'this_month', label: 'This month' }, { id: 'bills', label: 'Bills' }, { id: 'invoices', label: 'Invoices' }, { id: 'receipts', label: 'Receipts' }, { id: 'prescriptions', label: 'Prescriptions' }, { id: 'statements', label: 'Statements' }, { id: 'needs_attention', label: 'Needs attention' }]
function Library({ documents, searchResults, query, setQuery, searchFilter, setSearchFilter, loading, onScan, onImport, onCombine, onBulkUpdate, onBulkDelete, onOpen }: { documents: VaultDocument[]; searchResults: DocumentSearchResult[]; query: string; setQuery: (value: string) => void; searchFilter: SmartSearchFilter; setSearchFilter: (value: SmartSearchFilter) => void; loading: boolean; onScan: () => void; onImport: () => Promise<void>; onCombine: (documents: VaultDocument[]) => Promise<void>; onBulkUpdate: (ids: string[], action: { type: 'move' | 'tag' | 'privacy'; value: string | boolean }) => Promise<void>; onBulkDelete: (ids: string[]) => Promise<void>; onOpen: (id: string, page?: number) => void }) {
  const resultsById = useMemo(() => new Map(searchResults.map(result => [result.document.id, result])), [searchResults])
  const highlightQuery = useMemo(() => parseAdvancedQuery(query).text, [query])
  const [importing, setImporting] = useState(false), [importError, setImportError] = useState(''), [combining, setCombining] = useState(false)
  const [selecting, setSelecting] = useState(false), [selectedIds, setSelectedIds] = useState<string[]>([]), [bulkMode, setBulkMode] = useState<BulkEditMode | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false), [bulkError, setBulkError] = useState(''), [searchHelp, setSearchHelp] = useState(false)
  const closeCombine = useCallback(() => setCombining(false), [])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedDocuments = useMemo(() => documents.filter(document => selectedIdSet.has(document.id)), [documents, selectedIdSet])
  const clearSelection = useCallback(() => { setSelecting(false); setSelectedIds([]); setBulkMode(null); setBulkError('') }, [])
  const toggleSelected = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const applyBulk = async (type: 'move' | 'tag' | 'privacy', value: string | boolean) => {
    setBulkBusy(true); setBulkError('')
    try { await onBulkUpdate(selectedIds, { type, value }); clearSelection() }
    catch (error) { setBulkError(error instanceof Error ? error.message : 'Could not update the selected documents.') }
    finally { setBulkBusy(false) }
  }
  const deleteBulk = async () => {
    if (!confirm(`Delete ${selectedIds.length} selected documents from this device?`)) return
    setBulkBusy(true); setBulkError('')
    try { await onBulkDelete(selectedIds); clearSelection() }
    catch { setBulkError('Could not delete all selected documents.') }
    finally { setBulkBusy(false) }
  }
  const importPdf = async () => { setImporting(true); setImportError(''); try { await onImport() } catch (error) { setImportError(error instanceof Error ? error.message : 'Could not import this PDF.') } finally { setImporting(false) } }
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
      <div className="hero-actions"><button className="primary-button" onClick={onScan}><Camera /><span>Scan a document</span></button><button className="import-pdf-button" disabled={importing} onClick={() => void importPdf()}>{importing ? <span className="button-spinner" /> : <FileUp />}<span>{importing ? 'Importing locally…' : 'Import PDF'}</span></button></div>
      {importError && <p className="hero-error" role="alert">{importError}</p>}
    </section>
    <div className="search-field"><Search size={20} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search text or use filters" aria-label="Search documents" />{query ? <button onClick={() => setQuery('')} aria-label="Clear search"><X size={18} /></button> : null}<button onClick={() => setSearchHelp(open => !open)} aria-label="Advanced search help" aria-expanded={searchHelp}><CircleHelp size={18} /></button></div>
    {searchHelp ? <aside className="search-help"><strong>Advanced search</strong><span>Combine normal words with filters:</span><div>{['type:invoice', 'folder:"Tax records"', 'tag:important', 'amount:>5000', 'after:2026-01', 'private:true'].map(example => <button key={example} onClick={() => setQuery(normaliseQuery(`${query} ${example}`))}>{example}</button>)}</div></aside> : null}
    <div className="smart-filter-strip" aria-label="Document filters">{SEARCH_FILTERS.map(filter => <button key={filter.id} className={searchFilter === filter.id ? 'active' : ''} aria-pressed={searchFilter === filter.id} onClick={() => setSearchFilter(filter.id)}>{filter.label}</button>)}</div>
    <section className="section-block">
      <div className="section-heading"><div><span>{selecting ? `${selectedIds.length} selected` : query || searchFilter !== 'all' ? 'Matching documents' : 'Recent documents'}</span><small>{documents.length} {documents.length === 1 ? 'document' : 'documents'}</small></div><div className="section-tools">{selecting ? <button onClick={clearSelection}>Cancel</button> : <>{searchFilter !== 'all' ? <button onClick={() => setSearchFilter('all')}>Clear filter</button> : null}{documents.length >= 2 ? <button onClick={() => setCombining(true)}><Files /> Combine</button> : null}{documents.length ? <button onClick={() => setSelecting(true)}><Check /> Select</button> : null}</>}</div></div>
      {loading ? <EmptyLoading /> : documents.length ? <div className={`document-list${selecting ? ' selecting' : ''}`}>{documents.map(document => { const match = resultsById.get(document.id)?.pageMatches[0]; return <DocumentRow key={document.id} document={document} match={match} query={highlightQuery} selecting={selecting} selected={selectedIdSet.has(document.id)} onClick={() => selecting ? toggleSelected(document.id) : onOpen(document.id, match?.pageIndex)} /> })}</div> : <EmptyLibrary onScan={onScan} searching={Boolean(query || searchFilter !== 'all')} />}
    </section>
    <div className="privacy-note"><LockKeyhole size={18} /><div><strong>Private by design</strong><span>Your files and searches stay entirely on this device.</span></div></div>
    {combining && <CombineDocumentsSheet documents={documents} onClose={closeCombine} onCombine={onCombine} />}
    {selecting && selectedIds.length > 0 ? <BulkActionBar count={selectedIds.length} busy={bulkBusy} error={bulkError} allPrivate={selectedDocuments.every(document => document.isPrivate)} onMove={() => setBulkMode('move')} onTag={() => setBulkMode('tag')} onPrivacy={() => void applyBulk('privacy', !selectedDocuments.every(document => document.isPrivate))} onDelete={() => void deleteBulk()} onCancel={clearSelection} /> : null}
    {bulkMode ? <BulkOrganizeSheet mode={bulkMode} count={selectedIds.length} busy={bulkBusy} error={bulkError} onClose={() => setBulkMode(null)} onApply={value => void applyBulk(bulkMode, value)} /> : null}
  </>
}

const normaliseQuery = (value: string) => value.replace(/\s+/g, ' ').trim()

function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean), lowerTerms = new Set(terms.map(term => term.toLocaleLowerCase()))
  return <>{text.split(/(\s+)/).map((part, index) => lowerTerms.has(part.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase()) ? <mark key={index}>{part}</mark> : part)}</>
}
function DocumentRow({ document, match, query = '', selecting = false, selected = false, onClick }: { document: VaultDocument; match?: DocumentSearchResult['pageMatches'][number]; query?: string; selecting?: boolean; selected?: boolean; onClick: () => void }) {
  return <button className={`document-row${selected ? ' selected' : ''}`} onClick={onClick} aria-pressed={selecting ? selected : undefined}>
    {match && !document.isPrivate && <span className="match-page-badge">Page {match.pageIndex + 1}</span>}
    {selecting ? <span className="row-selector">{selected ? <Check /> : null}</span> : null}
    <div className={`doc-thumb${document.isPrivate ? ' private' : ''}`}>{document.isPrivate ? <Lock /> : document.pages[0]?.thumbnailUrl || document.pages[0]?.imageUrl ? <img src={document.pages[0].thumbnailUrl || document.pages[0].imageUrl} alt="" /> : <FileText />}</div>
    <div className="doc-main"><strong>{document.isPrivate ? 'Private document' : document.title}</strong><span>{formatDate(document.createdAt)} · {document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'}{document.isPrivate ? ' · Locked' : ''}</span>{match && !document.isPrivate ? <span className="search-snippet"><HighlightedText text={match.snippet} query={query} /></span> : <small className={document.status === 'error' ? 'status error' : 'status'}><i />{document.isPrivate ? 'Authenticate to open' : statusLabel(document)}</small>}</div>
    {selecting ? null : <ChevronRight className="row-arrow" size={20} />}
  </button>
}

function EmptyLibrary({ onScan, searching }: { onScan: () => void; searching: boolean }) {
  return <div className="empty-state"><div><FileText /></div><h3>{searching ? 'No matching documents' : 'Your cabinet is empty'}</h3><p>{searching ? 'Try another word or phrase.' : 'Scan your first document to make it searchable and easy to find.'}</p>{!searching && <button className="secondary-button" onClick={onScan}><Camera size={18} /> Scan now</button>}</div>
}

function CaptureScreen({ onClose, onSave }: { onClose: () => void; onSave: (doc: VaultDocument) => Promise<void> }) {
  const [pages, setPages] = useState<DocumentPage[]>([])
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editingMode, setEditingMode] = useState<'crop' | 'preview'>('crop')
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [folder, setFolder] = useState('Unfiled')
  const [cameraOpen, setCameraOpen] = useState(true)
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null)
  const draggedPageIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setProcessing(true); setCaptureError('')
    try {
      const addedPages = await filesToPages(files)
      setPages(current => [...current, ...addedPages]); setSelectedPageId(addedPages.at(-1)?.id ?? null)
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
  const movePageTo = (pageId: string, targetId: string) => setPages(current => {
    const from = current.findIndex(page => page.id === pageId)
    const to = current.findIndex(page => page.id === targetId)
    if (from < 0 || to < 0 || from === to) return current
    const reordered = [...current]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    return reordered
  })
  const beginPageDrag = (event: ReactPointerEvent<HTMLSpanElement>, pageId: string) => {
    event.preventDefault()
    draggedPageIdRef.current = pageId
    setDraggingPageId(pageId)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const continuePageDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const pageId = draggedPageIdRef.current
    if (!pageId) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-page-id]')?.dataset.pageId
    if (target && target !== pageId) movePageTo(pageId, target)
  }
  const endPageDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    draggedPageIdRef.current = null
    setDraggingPageId(null)
  }
  const reorderWithKeyboard = (event: ReactKeyboardEvent<HTMLSpanElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    movePage(index, event.key === 'ArrowLeft' ? -1 : 1)
  }
  const enhanceAllPages = async () => {
    if (processing || !pages.length) return
    setProcessing(true); setCaptureError('')
    try {
      const enhanced: DocumentPage[] = []
      for (const page of pages) {
        const result = await processPageImages(page.originalImageUrl ?? page.imageUrl, page.corners ?? defaultCorners, 'auto', defaultAdjustments)
        enhanced.push({ ...page, ...result, renderPreset: 'auto', adjustments: defaultAdjustments, processingState: 'processed', ocrState: 'pending', ocrText: '' })
      }
      setPages(enhanced)
    } catch (error) {
      console.error('Enhancing all pages failed', error)
      setCaptureError('One or more pages could not be enhanced. Your existing pages are unchanged.')
    } finally { setProcessing(false) }
  }
  const savePages = async (pagesToSave: DocumentPage[]) => {
    const now = new Date().toISOString()
    setSaving(true); setCaptureError('')
    try {
      console.info('[capture] save requested', { pageCount: pagesToSave.length, folder })
      const storage = await checkDocumentStorage(pagesToSave)
      if (!storage.ok) { setCaptureError(storage.message || 'Not enough free storage to save this document.'); setSaving(false); return false }
      await onSave({ id: crypto.randomUUID(), title: `Scanned document · ${formatDate(now)}`, titleSource: 'automatic', folder, createdAt: now, updatedAt: now, status: 'ocr_pending', processingStage: 'ocr', pages: pagesToSave, tags: [] })
      console.info('[capture] save handoff completed', { pageCount: pagesToSave.length })
      return true
    }
    catch (error) { console.error('[capture] save failed', error); setCaptureError('This document could not be saved. Check available device storage and try again.'); setSaving(false); return false }
  }
  const save = async () => { await savePages(pages) }
  const editingPage = pages.find(page => page.id === editingPageId)
  const selectedPage = pages.find(page => page.id === selectedPageId) ?? pages[0]
  const selectedIndex = selectedPage ? pages.indexOf(selectedPage) : -1
  const editSelected = (mode: 'crop' | 'preview') => { if (!selectedPage) return; setEditingMode(mode); setEditingPageId(selectedPage.id) }
  const deleteSelected = () => {
    if (!selectedPage) return
    const remaining = pages.filter(page => page.id !== selectedPage.id)
    setPages(remaining); setSelectedPageId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null)
    if (!remaining.length) setCameraOpen(true)
  }
  const closeScanner = () => pages.length ? setCameraOpen(false) : onClose()
  const completeNativeScan = async (files: File[]) => {
    setProcessing(true); setCaptureError('')
    try {
      console.info('[scanner] preparing returned ML Kit pages', { fileCount: files.length, existingPageCount: pages.length })
      const captured = await nativeScansToPages(files)
      setPages(currentPages => [...currentPages, ...captured])
      setSelectedPageId(captured.at(-1)?.id ?? null)
      setCameraOpen(false)
      console.info('[scanner] returned ML Kit pages ready for review', { pageCount: captured.length })
    } catch (error) {
      console.error('[scanner] returned ML Kit pages could not be prepared', error)
      setCaptureError('The scanned pages could not be prepared. Please try scanning them again.')
      throw error
    } finally { setProcessing(false) }
  }
  if (editingPage) return <ScanPageEditor page={editingPage} pageNumber={pages.indexOf(editingPage) + 1} initialMode={editingMode} onCancel={() => setEditingPageId(null)} onSave={updated => { setPages(current => current.map(page => page.id === updated.id ? updated : page)); setEditingPageId(null) }} />
  if (cameraOpen && nativeDocumentScannerService.available()) return <NativeDocumentScanner onCancel={closeScanner} onComplete={completeNativeScan} />
  if (cameraOpen) return <InAppCamera pageCount={pages.length} latestPageUrl={pages.at(-1)?.thumbnailUrl || pages.at(-1)?.imageUrl} onClose={closeScanner} onDone={() => { setSelectedPageId(pages.at(-1)?.id ?? null); setCameraOpen(false) }} onRetake={() => setPages(currentPages => { const remaining = currentPages.slice(0, -1); setSelectedPageId(remaining.at(-1)?.id ?? null); return remaining })} onImport={() => { setCameraOpen(false); setTimeout(() => inputRef.current?.click()) }} onCapture={async (file, proposed) => { setProcessing(true); setCaptureError(''); try { const captured = await filesToPages([file], proposed); setPages(currentPages => [...currentPages, ...captured]); setSelectedPageId(captured.at(-1)?.id ?? null) } catch { setCaptureError('The captured page could not be processed. Please try again.') } finally { setProcessing(false) } }} />

  return <div className="full-screen capture-review-screen">
    <header className="top-bar"><button onClick={onClose} aria-label="Cancel"><X /></button><div><strong>New scan</strong><span>{saving ? 'Saving safely on this device…' : processing ? 'Finding document edges…' : pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} captured` : 'Add your pages'}</span></div><button className="text-action" disabled={!pages.length || processing || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></header>
    {!pages.length ? <section className="capture-empty">
      <div className="viewfinder"><span /><span /><span /><span /><FileText /></div>
      <h2>Ready to scan</h2><p>Place the document on a flat surface with good lighting.</p>
      <button className="primary-button" onClick={() => setCameraOpen(true)}><Camera /> Open LOCAL camera</button>
      <button className="secondary-button" onClick={() => inputRef.current?.click()}><Upload /> Import photos</button>
    </section> : <>
      <section className="scan-review-heading"><div><strong>Review your scan</strong><span>{pages.length > 1 ? 'Auto-enhanced · drag handles to reorder' : 'Auto-enhanced · tap to refine borders'}</span></div><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option>Unfiled</option><option>Office</option><option>Personal</option><option>Receipts</option><option>Legal</option></select></label></section>
      {selectedPage ? <section className="scan-review"><button className="scan-review-preview" onClick={() => editSelected('crop')} aria-label={`Adjust page ${selectedIndex + 1}`}><img src={selectedPage.imageUrl} alt={`Page ${selectedIndex + 1}`} style={{ transform: `rotate(${selectedPage.rotation}deg)` }} />{selectedPage.processingState === 'needs_review' ? <span>Check borders</span> : null}</button><div className="review-order"><button onClick={() => movePage(selectedIndex, -1)} disabled={selectedIndex <= 0} aria-label="Move page earlier"><ArrowLeft /></button><span>Page {selectedIndex + 1} of {pages.length}</span><button onClick={() => movePage(selectedIndex, 1)} disabled={selectedIndex >= pages.length - 1} aria-label="Move page later"><ChevronRight /></button></div></section> : null}
      <section className="review-thumbnails" aria-label="Captured pages">{pages.map((page, index) => <div key={page.id} data-page-id={page.id} className={`review-thumbnail${page.id === selectedPage?.id ? ' active' : ''}${page.id === draggingPageId ? ' dragging' : ''}`}><button onClick={() => setSelectedPageId(page.id)} aria-label={`Open page ${index + 1}`}><img src={page.thumbnailUrl || page.imageUrl} alt="" /><span>{index + 1}</span></button>{pages.length > 1 ? <span className="page-drag-handle" role="button" tabIndex={0} aria-label={`Reorder page ${index + 1}. Use left and right arrow keys, or drag.`} onKeyDown={event => reorderWithKeyboard(event, index)} onPointerDown={event => beginPageDrag(event, page.id)} onPointerMove={continuePageDrag} onPointerUp={endPageDrag} onPointerCancel={endPageDrag}><GripVertical /></span> : null}</div>)}</section>
      <nav className="scan-review-toolbar" aria-label="Page editing tools"><button disabled={processing} onClick={() => setCameraOpen(true)}><ImagePlus /><span>Add</span></button><button disabled={processing} onClick={() => editSelected('crop')}><Crop /><span>Crop</span></button><button disabled={processing} onClick={() => selectedPage && rotate(selectedPage.id)}><RotateCw /><span>Rotate</span></button><button disabled={processing} onClick={() => void enhanceAllPages()}><ScanLine /><span>Enhance all</span></button><button disabled={processing} className="danger" onClick={deleteSelected}><Trash2 /><span>Delete</span></button></nav>
      {processing && <div className="page-processing"><span className="button-spinner" /> Processing each page on this device…</div>}
      {captureError && <div className="scanner-error" role="alert">{captureError}</div>}
    </>}
    <input ref={inputRef} className="hidden-input" type="file" accept="image/*" multiple onChange={event => void addFiles(event.target.files)} />
  </div>
}

function Viewer({ document, initialPage = 0, initialQuery = '', onBack, onChange, onCreate, onDelete }: { document: VaultDocument; initialPage?: number; initialQuery?: string; onBack: () => void; onChange: (doc: VaultDocument) => Promise<void>; onCreate: (doc: VaultDocument) => Promise<void>; onDelete: () => void }) {
  const [page, setPage] = useState(Math.min(Math.max(initialPage, 0), Math.max(0, document.pages.length - 1)))
  const [editing, setEditing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(Boolean(initialQuery))
  const [withinQuery, setWithinQuery] = useState(initialQuery)
  const [title, setTitle] = useState(document.title)
  const [editingPage, setEditingPage] = useState(false)
  const [exportState, setExportState] = useState<'idle' | 'working' | 'success' | 'opening' | 'error'>('idle')
  const [exportError, setExportError] = useState('')
  const [shareState, setShareState] = useState<'idle' | 'working' | 'error'>('idle')
  const [jobAction, setJobAction] = useState<'idle' | 'working'>('idle')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionView, setActionView] = useState<'main' | 'folder' | 'password' | 'private' | 'extract' | 'compress' | 'tags'>('main')
  const [customFolder, setCustomFolder] = useState('')
  const [pdfPassword, setPdfPassword] = useState('')
  const [pdfPasswordConfirm, setPdfPasswordConfirm] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [compressionLevel, setCompressionLevel] = useState<PdfCompressionLevel>('balanced')
  const [compressionMessage, setCompressionMessage] = useState('')
  const current = document.pages[page]
  const detectedCodes = useMemo(() => document.pages.flatMap(item => item.barcodes ?? []), [document.pages])
  const matches = useMemo(() => pageMatches(document, withinQuery), [document, withinQuery])
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const activeMatch = matches[activeMatchIndex]
  useEffect(() => {
    void screenSecurityService.setEnabled(Boolean(document.isPrivate))
    return () => { void screenSecurityService.setEnabled(false) }
  }, [document.isPrivate])
  useEffect(() => () => { void privateStorageService.clearSession(document.privateSessionId) }, [document.privateSessionId])
  useEffect(() => { setTitle(document.title) }, [document.title])
  useEffect(() => {
    if (!actionsOpen) return
    const previousOverflow = globalThis.document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeActions() }
    globalThis.document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => { globalThis.document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape) }
  }, [actionsOpen])
  useEffect(() => { setActiveMatchIndex(0); if (matches[0]) setPage(matches[0].pageIndex) }, [matches])
  const moveMatch = (direction: -1 | 1) => {
    if (!matches.length) return
    const next = (activeMatchIndex + direction + matches.length) % matches.length
    setActiveMatchIndex(next); setPage(matches[next].pageIndex)
  }
  const saveTitle = () => { const trimmed = title.trim(); if (trimmed) onChange({ ...document, title: trimmed, titleSource: 'manual', updatedAt: new Date().toISOString() }); setEditing(false) }
  const closeActions = () => { setActionsOpen(false); setActionView('main'); setCustomFolder(''); setPdfPassword(''); setPdfPasswordConfirm(''); setActionError(''); setCompressionMessage('') }
  const updateMetadata = async (changes: Partial<Pick<VaultDocument, 'folder' | 'isPrivate'>>) => {
    setActionBusy(true); setActionError('')
    try { await onChange({ ...document, ...changes, updatedAt: new Date().toISOString() }); closeActions() }
    catch { setActionError('Could not update this document. Please try again.') }
    finally { setActionBusy(false) }
  }
  const togglePrivacy = async () => {
    setActionBusy(true); setActionError('')
    try {
      await appLockService.authenticate()
      await onChange({ ...document, isPrivate: !document.isPrivate, updatedAt: new Date().toISOString() })
      if (document.isPrivate) closeActions()
      else { setActionBusy(false); setActionView('private') }
    } catch { setActionError('Authentication was cancelled or unsuccessful.') }
    finally { setActionBusy(false) }
  }
  const applyPdfPassword = async () => {
    if (pdfPassword.length < 8) { setActionError('Use at least 8 characters.'); return }
    if (pdfPassword !== pdfPasswordConfirm) { setActionError('The passwords do not match.'); return }
    setActionBusy(true); setActionError('')
    try { const updated = await passwordProtectPdf(document, pdfPassword); await onChange(updated); closeActions() }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not protect this PDF.') }
    finally { setActionBusy(false) }
  }
  const clearPdfPassword = async () => {
    setActionBusy(true); setActionError('')
    try { const updated = await removePdfPassword(document); await onChange(updated); closeActions() }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not remove PDF password protection.') }
    finally { setActionBusy(false) }
  }
  const extractSelectedPages = async (indexes: number[]) => {
    setActionBusy(true); setActionError('')
    try { await onCreate(await extractPages(document, indexes)) }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not extract these pages.'); setActionBusy(false) }
  }
  const compressPdf = async () => {
    setActionBusy(true); setActionError(''); setCompressionMessage('')
    try {
      const result = await downloadCompressedPdf(document, compressionLevel)
      setCompressionMessage(`Saved ${Math.max(.1, result.bytes / 1024 / 1024).toFixed(1)} MB copy to Downloads · LOCAL`)
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not compress this PDF.') }
    finally { setActionBusy(false) }
  }
  const saveTags = async (tags: string[]) => {
    setActionBusy(true); setActionError('')
    try { await onChange({ ...document, tags, updatedAt: new Date().toISOString() }); closeActions() }
    catch { setActionError('Could not save these tags. Please try again.') }
    finally { setActionBusy(false) }
  }
  const highlights = activeMatch?.pageIndex === page ? activeMatch.wordIndexes.flatMap(index => current.ocrWords?.[index]?.boundingBox ?? []) : []
  const downloadPdf = async () => {
    setExportState('working'); setExportError('')
    try {
      const exported = await downloadPdfFile(document)
      if (exported !== document) onChange(exported)
      setExportState('success')
    } catch (error) {
      console.error(error)
      setExportError('Could not save this PDF to Downloads. Check that every scanned page can be opened, then try again.')
      setExportState('error')
    }
  }
  const openPdf = async () => {
    setExportState('opening'); setExportError('')
    try { await openDownloadedPdf(); setExportState('success') }
    catch (error) { console.error(error); setExportError(error instanceof Error ? error.message : 'No app could open this PDF.'); setExportState('success') }
  }
  const sharePdf = async () => {
    setShareState('working')
    try {
      const shared = await sharePdfFile(document)
      if (shared !== document) await onChange(shared)
      setShareState('idle')
    } catch (error) {
      console.error(error)
      setShareState('error')
    }
  }
  const saveEditedPage = async (updatedPage: DocumentPage) => {
    const updatedDocument: VaultDocument = {
      ...document,
      pages: document.pages.map(item => item.id === updatedPage.id ? updatedPage : item),
      status: 'ocr_pending',
      processingStage: 'ocr',
      pdfPath: undefined,
      privatePdfPath: undefined,
      pdfGeneratedAt: undefined,
      pdfPasswordProtected: undefined,
      updatedAt: new Date().toISOString(),
    }
    await onChange(updatedDocument)
    setEditingPage(false)
    void retryProcessing(updatedDocument.id, onChange)
  }
  if (editingPage && current) return <ScanPageEditor page={current} pageNumber={page + 1} initialMode="crop" onCancel={() => setEditingPage(false)} onSave={updated => { void saveEditedPage(updated) }} />
  return <div className="full-screen viewer-screen">
    <header className="top-bar"><button onClick={onBack} aria-label="Back"><ArrowLeft /></button><div>{editing ? <input className="title-edit" value={title} onChange={event => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={event => event.key === 'Enter' && saveTitle()} autoFocus /> : <><strong>{document.isPrivate && <Lock size={13} />} {document.title}</strong><span>{document.folder} · {document.pages.length} pages</span></>}</div><button onClick={() => setActionsOpen(true)} aria-label="More actions" aria-haspopup="dialog"><MoreHorizontal /></button></header>
    <div className={`processing-banner ${document.status === 'error' ? 'has-error' : ''}`}><Clock3 size={17} /><span>{statusLabel(document)}</span>{document.status === 'indexed' && <Check size={17} />}{(document.status === 'ocr_pending' || document.status === 'ocr_processing') && <button disabled={jobAction === 'working'} onClick={() => { setJobAction('working'); void cancelProcessing(document.id, updated => { onChange(updated); setJobAction('idle') }) }}><PauseCircle /> Pause</button>}{(document.status === 'error' || document.status === 'saved') && (document.processingStage === 'pdf' || document.pages.some(item => item.ocrState !== 'complete')) && <button disabled={jobAction === 'working'} onClick={() => { setJobAction('working'); void retryProcessing(document.id, updated => { onChange(updated); if (updated.status === 'indexed' || updated.status === 'error') setJobAction('idle') }) }}><RefreshCw /> {document.processingStage === 'pdf' ? 'Retry PDF' : 'Retry OCR'}</button>}<button onClick={() => setSearchOpen(open => !open)}><Search /> Search text</button></div>
    {searchOpen && <div className="viewer-search"><Search /><input value={withinQuery} onChange={event => setWithinQuery(event.target.value)} placeholder="Search this document" aria-label="Search this document" autoFocus /><span>{withinQuery ? matches.length ? `${activeMatchIndex + 1}/${matches.length}` : '0' : ''}</span><button onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="Previous match"><ChevronUp /></button><button onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="Next match"><ChevronDown /></button><button onClick={() => { setWithinQuery(''); setSearchOpen(false) }} aria-label="Close search"><X /></button></div>}
    {document.tags.length > 0 && <div className="viewer-tags" aria-label="Document tags">{document.tags.map(tag => <span key={tag}><Tag />{tag}</span>)}</div>}
    {detectedCodes.length > 0 && <div className="code-index-banner"><ScanLine /><strong>{detectedCodes.length} {detectedCodes.length === 1 ? 'code' : 'codes'} indexed</strong><span>{detectedCodes[0].displayValue || detectedCodes[0].rawValue}</span></div>}
    <section className="document-canvas">{current && <ZoomablePage key={current.id} src={current.imageUrl} alt={`Page ${page + 1}`} rotation={current.rotation} highlights={highlights} />}{activeMatch?.pageIndex === page && <div className="viewer-match"><b>Page {page + 1}</b><span><HighlightedText text={activeMatch.snippet} query={withinQuery} /></span></div>}</section>
    <section className="thumbnail-strip" aria-label="Pages">{document.pages.map((item, index) => <button key={item.id} className={index === page ? 'active' : ''} onClick={() => setPage(index)}><img src={item.imageUrl} alt={`Page ${index + 1}`} /><span>{index + 1}</span></button>)}</section>
    <footer className="viewer-actions">
      <div className="primary-document-actions"><button className="export-action" onClick={() => void (exportState === 'success' ? openPdf() : downloadPdf())} disabled={exportState === 'working' || exportState === 'opening'}>{exportState === 'working' || exportState === 'opening' ? <span className="button-spinner" /> : exportState === 'success' ? <ExternalLink /> : <Download />}<span>{exportState === 'working' ? 'Saving PDF…' : exportState === 'opening' ? 'Opening PDF…' : exportState === 'success' ? 'Open PDF' : 'Download PDF'}</span></button><button className="share-action" onClick={() => void sharePdf()} disabled={shareState === 'working'} aria-label="Share PDF">{shareState === 'working' ? <span className="button-spinner" /> : <Share2 />}</button></div>
      {exportState === 'success' && <p className="export-success"><Check /> Saved to Downloads · LOCAL</p>}
      {exportError && <p className="export-error">{exportError}</p>}
      {shareState === 'error' && <p className="export-error">Could not open sharing for this PDF. Please try again.</p>}
    </footer>
    {actionsOpen && <div className="action-sheet-layer" role="presentation" onClick={closeActions}>
      <section className="document-action-sheet" role="dialog" aria-modal="true" aria-label={actionView === 'folder' ? 'Move document' : 'Document actions'} onClick={event => event.stopPropagation()}>
        <div className="sheet-handle" />
        {actionView === 'main' ? <>
          <header><div><strong>Document options</strong><span>{document.folder}{document.isPrivate ? ' · Private' : ''}</span></div><button onClick={closeActions} aria-label="Close"><X /></button></header>
          <div className="sheet-actions">
            <button onClick={() => { closeActions(); setEditingPage(true) }}><Crop /><span><strong>Crop this page</strong><small>Adjust the borders of page {page + 1}</small></span><ChevronRight /></button>
            <button onClick={() => { closeActions(); setEditing(true) }}><Pencil /><span><strong>Rename</strong><small>Change the document name</small></span><ChevronRight /></button>
            <button onClick={() => setActionView('folder')}><FolderOpen /><span><strong>Move to folder</strong><small>Currently in {document.folder}</small></span><ChevronRight /></button>
            <button onClick={() => setActionView('tags')}><Tag /><span><strong>Manage tags</strong><small>{document.tags.length ? document.tags.join(', ') : 'Add searchable labels'}</small></span><ChevronRight /></button>
            {document.pages.length > 1 && <button onClick={() => setActionView('extract')}><Copy /><span><strong>Extract pages</strong><small>Create a separate document from selected pages</small></span><ChevronRight /></button>}
            <button onClick={() => setActionView('compress')}><Minimize2 /><span><strong>Compress PDF</strong><small>Download a smaller sharing copy</small></span><ChevronRight /></button>
            <button disabled={actionBusy} onClick={() => void togglePrivacy()}>{document.isPrivate ? <Unlock /> : <Lock />}<span><strong>{document.isPrivate ? 'Remove private lock' : 'Make private'}</strong><small>{document.isPrivate ? 'Stop requiring document-level authentication' : 'Lock access inside LOCAL and hide previews'}</small></span><ChevronRight /></button>
            <button onClick={() => setActionView('password')}><ShieldCheck /><span><strong>{document.pdfPasswordProtected ? 'Change PDF password' : 'Add PDF password'}</strong><small>{document.pdfPasswordProtected ? 'AES-256 protection is enabled' : 'Protect Downloads and shared copies'}</small></span><ChevronRight /></button>
            <button className="danger" onClick={() => { closeActions(); if (confirm('Delete this document from this device?')) onDelete() }}><Trash2 /><span><strong>Delete document</strong><small>Remove it permanently from this device</small></span><ChevronRight /></button>
          </div>
        </> : actionView === 'folder' ? <>
          <header><button onClick={() => setActionView('main')} aria-label="Back"><ArrowLeft /></button><div><strong>Move to folder</strong><span>Choose where this document belongs</span></div><button onClick={closeActions} aria-label="Close"><X /></button></header>
          <div className="folder-options">{['Unfiled', 'Office', 'Personal', 'Receipts', 'Legal'].map(folder => <button key={folder} className={document.folder === folder ? 'selected' : ''} disabled={actionBusy} onClick={() => void updateMetadata({ folder })}><Folder /> <span>{folder}</span>{document.folder === folder && <Check />}</button>)}</div>
          <form className="custom-folder" onSubmit={event => { event.preventDefault(); const folder = customFolder.trim(); if (folder) void updateMetadata({ folder }) }}><label htmlFor="custom-folder-name">New folder</label><div><input id="custom-folder-name" value={customFolder} onChange={event => setCustomFolder(event.target.value)} placeholder="Enter folder name" maxLength={48} /><button disabled={actionBusy || !customFolder.trim()}><Check /> Move</button></div></form>
        </> : actionView === 'tags' ? <TagEditorSheet initialTags={document.tags} busy={actionBusy} error={actionError} onClose={closeActions} onSave={tags => void saveTags(tags)} />
        : actionView === 'extract' ? <PageExtractSheet document={document} initialPage={page} busy={actionBusy} error={actionError} onClose={closeActions} onExtract={indexes => void extractSelectedPages(indexes)} />
        : actionView === 'compress' ? <CompressionSheet selected={compressionLevel} busy={actionBusy} message={compressionMessage} error={actionError} onSelect={setCompressionLevel} onClose={closeActions} onCompress={() => void compressPdf()} />
        : actionView === 'private' ? <>
          <header><div><strong>Private lock enabled</strong><span>This document now requires device authentication in LOCAL</span></div><button onClick={closeActions} aria-label="Close"><X /></button></header>
          <div className="privacy-level-card"><Lock /><strong>Protected inside LOCAL</strong><p>The title and preview are hidden. Add a PDF password as well if downloaded and shared copies must remain protected.</p><button onClick={() => setActionView('password')}><ShieldCheck /> Add PDF password</button><button className="quiet" onClick={closeActions}>Done</button></div>
        </> : <>
          <header><button onClick={() => setActionView('main')} aria-label="Back"><ArrowLeft /></button><div><strong>{document.pdfPasswordProtected ? 'Change PDF password' : 'Add PDF password'}</strong><span>Protect the PDF outside LOCAL</span></div><button onClick={closeActions} aria-label="Close"><X /></button></header>
          <form className="password-protection-form" onSubmit={event => { event.preventDefault(); void applyPdfPassword() }}><div className="portable-protection-note"><ShieldCheck /><div><strong>AES-256 PDF protection</strong><span>Foxit and other compatible readers will request this password.</span></div></div><label>Password<input type="password" value={pdfPassword} onChange={event => setPdfPassword(event.target.value)} minLength={8} maxLength={64} autoComplete="new-password" placeholder="At least 8 characters" /></label><label>Confirm password<input type="password" value={pdfPasswordConfirm} onChange={event => setPdfPasswordConfirm(event.target.value)} minLength={8} maxLength={64} autoComplete="new-password" placeholder="Enter it again" /></label><p>LOCAL does not save this password and cannot recover it. Keep it somewhere safe.</p><button className="protect-pdf-button" disabled={actionBusy || pdfPassword.length < 8 || pdfPasswordConfirm.length < 8}>{actionBusy ? <span className="button-spinner" /> : <Lock />} {document.pdfPasswordProtected ? 'Replace password' : 'Protect PDF'}</button>{document.pdfPasswordProtected && <button type="button" className="remove-pdf-password" disabled={actionBusy} onClick={() => void clearPdfPassword()}><Unlock /> Remove PDF password</button>}</form>
        </>}
        {actionError && <p className="sheet-error" role="alert">{actionError}</p>}
      </section>
    </div>}
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
  return <><PageHeader icon={<Settings />} title="Settings" subtitle="Privacy and local storage" /><section className="privacy-card"><div className="shield"><ShieldCheck /></div><div><h2>Private by design</h2><p>Documents stay on this device. OCR and search indexing run locally. No document data is uploaded.</p></div></section><StorageSecurityPanel /><AppProtectionPanel /><BackupPanel /><button className="scanner-lab-entry" onClick={onOpenScannerLab}><span><ScanLine /></span><div><strong>Scanner Lab</strong><small>Compare processing on a test document</small></div><ChevronRight /></button><section className="settings-list"><h3>Privacy status</h3>{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong><i />{value}</strong></div>)}</section><section className="about-card"><span>LOCAL</span><small>Version 0.1.0</small><p>A quiet, private home for your important papers.</p></section></>
}

function AppProtectionPanel() {
  const [available, setAvailable] = useState(false), [enabled, setEnabled] = useState(appLockService.enabled()), [busy, setBusy] = useState(true), [message, setMessage] = useState('')
  useEffect(() => { void appLockService.available().then(setAvailable).catch(() => setAvailable(false)).finally(() => setBusy(false)) }, [])
  const toggle = async () => {
    setBusy(true); setMessage('')
    try { await appLockService.authenticate(); appLockService.setEnabled(!enabled); setEnabled(!enabled); setMessage(!enabled ? 'LOCAL will lock after 30 seconds in the background.' : 'App lock disabled.') }
    catch { setMessage('Authentication was cancelled or unsuccessful.') }
    finally { setBusy(false) }
  }
  return <section className="protection-card"><span><LockKeyhole /></span><div><strong>App lock</strong><small>{available ? 'Use fingerprint, face unlock or your device PIN.' : 'Available in the Android app when a secure screen lock is configured.'}</small>{message && <em>{message}</em>}</div><button role="switch" aria-checked={enabled} disabled={busy || !available} className={enabled ? 'on' : ''} onClick={() => void toggle()}><i /></button></section>
}

function AppLockScreen({ checking, onUnlock }: { checking: boolean; onUnlock: () => void }) {
  useEffect(() => {
    void screenSecurityService.setEnabled(true)
    return () => { void screenSecurityService.setEnabled(false) }
  }, [])
  return <div className="app-lock-screen"><div className="brand-mark"><Archive /></div><h1>LOCAL is locked</h1><p>Your documents remain private until you authenticate.</p><button disabled={checking} onClick={onUnlock}>{checking ? <span className="button-spinner" /> : <LockKeyhole />} {checking ? 'Checking…' : 'Unlock LOCAL'}</button></div>
}

function BackupPanel() {
  const [passphrase, setPassphrase] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const create = async () => { setBusy(true); setMessage('Preparing encrypted backup…'); try { const result = await backupService.create(passphrase); setMessage(`${result.count} documents encrypted. Keep the file and passphrase separately.`) } catch (error) { setMessage(error instanceof Error ? error.message : 'Backup failed.') } finally { setBusy(false) } }
  const restore = async (file?: File) => {
    if (!file) return
    if (!confirm('Restore documents from this backup? Documents with matching IDs will be updated.')) { if (input.current) input.current.value = ''; return }
    setBusy(true); setMessage('Unlocking and restoring backup…')
    try { const result = await backupService.restore(file, passphrase); setMessage(`${result.count} documents restored. Return to Library to view them.`) } catch (error) { setMessage(error instanceof Error ? error.message : 'Restore failed.') } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return <section className="backup-card"><div><strong>Encrypted backup</strong><span>Save a password-protected copy of documents and searchable text.</span></div><label>Backup passphrase<input type="password" value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></label><div className="backup-actions"><button disabled={busy || passphrase.length < 8} onClick={() => void create()}><Download /> Create backup</button><button disabled={busy || passphrase.length < 8} onClick={() => input.current?.click()}><Upload /> Restore backup</button></div><input ref={input} className="hidden-input" type="file" accept=".localbackup,application/json" onChange={event => void restore(event.target.files?.[0])} />{message && <p role="status">{message}</p>}</section>
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) { return <header className="page-header"><div className="brand-mark">{icon}</div><div><h1>{title}</h1><p>{subtitle}</p></div></header> }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={`nav-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span className="nav-icon">{icon}</span><span className="nav-label">{label}</span></button> }
function EmptyLoading() { return <div className="loading-state"><span /><span /><span /></div> }

export default App
