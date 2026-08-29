import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Archive, ArrowLeft, Bookmark, Camera, Check, ChevronRight, CircleHelp, Clock3, Copy, Crop, Download, Eraser, Eye, EyeOff, ExternalLink, FileText, FileUp, Files, Folder, FolderOpen, GripVertical, Highlighter, Home, ImagePlus, LockKeyhole, Moon, MoreHorizontal, MousePointer2, Redo2, RotateCw, Save, ScanLine, Search, Settings, ShieldCheck, ChevronDown, ChevronUp, Share2, Sun, Tag, Trash2, Undo2, Upload, Volume2, VolumeX, X, PauseCircle, RefreshCw, Pencil, Lock, Unlock, RotateCcw, AlertTriangle, Grid2X2, List, SlidersHorizontal, BookOpen, Rows3, AppWindow, Hash } from 'lucide-react'
import type { AnnotationStroke, DocumentPage, Screen, VaultDocument } from './domain/types'
import { documentsRepository } from './services/documentRepository'
import { cancelProcessing, processDocument, resumePendingProcessing, retryProcessing } from './services/processingQueue'
import { filesToPages, nativeScansToPages } from './services/scannerService'
import { downloadCompressedPdf, downloadPdf as downloadPdfFile, openDownloadedPdf, openPdfExternally, passwordProtectPdf, removePdfPassword, sharePdf as sharePdfFile, type PdfCompressionLevel } from './services/pdfService'
import { ScanPageEditor } from './features/scanner/components/ScanPageEditor'
import { ScannerLab } from './features/scanner/components/ScannerLab'
import { documentStorageService } from './services/documentStorageService'
import { searchService, pageMatches, parseAdvancedQuery, type DocumentSearchResult, type SmartSearchFilter } from './services/searchService'
import { ContinuousPages, ZoomablePage } from './features/viewer/components/ZoomablePage'
import { checkDocumentStorage } from './services/storageHealthService'
import { InAppCamera } from './features/scanner/components/InAppCamera'
import { NativeDocumentScanner } from './features/scanner/components/NativeDocumentScanner'
import { nativeDocumentScannerService } from './services/nativeDocumentScannerService'
import { processPageImages } from './features/scanner/services/scannerProcessingService'
import { defaultAdjustments } from './features/scanner/processing/renderPresets'
import { defaultCorners } from './features/scanner/processing/edgeDetection'
import { backgroundProcessingService } from './services/backgroundProcessingService'
import { backupService, type BackupPayload, type RestoreConflictPolicy } from './services/backupService'
import { appLockService } from './services/appLockService'
import { pdfImportService } from './services/pdfImportService'
import { analyseDocumentPages, combineDocuments, extractPages, insertDocumentPages, removeDocumentPages, reorderDocumentPages } from './services/documentOperationsService'
import { exportOcrText } from './services/textExportService'
import { TagEditorSheet } from './features/viewer/components/TagEditorSheet'
import { BulkActionBar, BulkOrganizeSheet, type BulkEditMode } from './features/library/components/BulkDocumentTools'
import { StorageSecurityPanel } from './features/settings/components/StorageSecurityPanel'
import { screenSecurityService } from './services/screenSecurityService'
import { privateStorageService } from './services/privateStorageService'
import { folderService } from './services/folderService'
import { viewerStateService, type ViewerReadingState } from './services/viewerStateService'
import { annotationCopy, finalizeAnnotations } from './services/annotationService'
import { ActionsScreen } from './features/actions/ActionsScreen'
import type { ActionSaveMode } from './features/actions/ActionsScreen'
import packageMetadata from '../package.json'

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(value))
const statusLabel = (doc: VaultDocument) => {
  if (doc.status === 'indexed') return doc.pages.some((page) => page.ocrText.trim() || page.barcodes?.length) ? 'Searchable' : 'No text detected'
  if (doc.status === 'error') {
    if (doc.processingStage === 'pdf') return 'Searchable PDF needs retry'
    const failed = doc.pages.filter((page) => page.ocrState === 'error').length
    return `${failed || 1} ${failed === 1 ? 'page needs' : 'pages need'} text recognition again`
  }
  if (doc.processingStage === 'pdf') return 'Creating searchable PDF'
  if (doc.processingStage === 'indexing') return 'Indexing document'
  const done = doc.pages.filter((page) => page.ocrState === 'complete').length
  return done ? `Reading text · ${done} of ${doc.pages.length} pages` : `Preparing text · 0 of ${doc.pages.length} pages`
}

function App() {
  const [screen, setScreen] = useState<Screen>(() => (import.meta.env.DEV && new URLSearchParams(window.location.search).has('scanner-lab') ? { name: 'scanner-lab' } : { name: 'home' }))
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])
  const [searchFilter, setSearchFilter] = useState<SmartSearchFilter>('all')
  const deferredQuery = useDeferredValue(query)
  const [lockState, setLockState] = useState<'checking' | 'locked' | 'unlocked'>('checking')
  const [backHint, setBackHint] = useState(false)
  const lastBackAt = useRef(0)
  const hiddenAt = useRef(0)
  const unlocking = useRef(false)
  const privateViewerId = useRef<string | undefined>(undefined)
  const sessionCleanup = useRef<Promise<void>>(Promise.resolve())

  const updateDocument = useCallback((updated: VaultDocument) => {
    setDocuments((current) => current.map((item) => (item.id === updated.id ? { ...updated } : item)))
    setSearchResults((current) => current.map((result) => (result.document.id === updated.id ? { ...result, document: { ...updated } } : result)))
  }, [])

  useEffect(() => {
    void privateStorageService.clearAllSessions()
    void documentsRepository.listDeleted().catch(() => undefined)
  }, [])
  const unlock = useCallback(async () => {
    if (unlocking.current) return
    unlocking.current = true
    try {
      await appLockService.authenticate()
      await sessionCleanup.current
      const documentId = privateViewerId.current
      if (documentId) {
        const revealed = await documentsRepository.reveal(documentId)
        if (!revealed) throw new Error('The private document is no longer available.')
        updateDocument(revealed)
      }
      setLockState('unlocked')
    } catch {
      setLockState('locked')
    } finally {
      unlocking.current = false
    }
  }, [updateDocument])
  useEffect(() => {
    if (!appLockService.enabled()) setLockState('unlocked')
    else void unlock()
  }, [unlock])
  useEffect(() => {
    const protect = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        if (privateViewerId.current) {
          setLockState('locked')
          sessionCleanup.current = privateStorageService.clearAllSessions()
        }
      } else if (appLockService.enabled() && hiddenAt.current && Date.now() - hiddenAt.current > 30_000) setLockState('locked')
    }
    document.addEventListener('visibilitychange', protect)
    return () => document.removeEventListener('visibilitychange', protect)
  }, [])

  const refresh = async () => {
    const results = await searchService.search(deferredQuery, searchFilter)
    const allDocuments = deferredQuery || searchFilter !== 'all' ? await documentsRepository.list() : results.map((result) => result.document)
    setSearchResults(results)
    setDocuments(allDocuments)
    setLoading(false)
  }
  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [deferredQuery, searchFilter])

  useEffect(() => {
    void resumePendingProcessing(updateDocument)
    const resume = () => {
      if (document.visibilityState === 'visible') void resumePendingProcessing(updateDocument)
    }
    document.addEventListener('visibilitychange', resume)
    let disposed = false
    let removeNativeListener = () => {}
    void backgroundProcessingService
      .onChange((_documentId, state) => {
        if (state === 'running' || state === 'succeeded' || state === 'failed') void resumePendingProcessing(updateDocument)
      })
      .then((remove) => {
        if (disposed) remove()
        else removeNativeListener = remove
      })
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', resume)
      removeNativeListener()
    }
  }, [updateDocument])
  const open = (next: Screen) => {
    setScreen(next)
    if (next.name === 'home') void refresh()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  useEffect(() => {
    let remove = () => undefined
    let hintTimer = 0
    void CapacitorApp.addListener('backButton', () => {
      const localEvent = new CustomEvent('local:back', { cancelable: true })
      if (!window.dispatchEvent(localEvent)) return
      const now = Date.now()
      if (screen.name !== 'home') {
        lastBackAt.current = now
        setBackHint(true)
        hintTimer = window.setTimeout(() => setBackHint(false), 900)
        open({ name: 'home' })
        return
      }
      if (now - lastBackAt.current <= 2000) { setBackHint(false); void CapacitorApp.minimizeApp(); return }
      lastBackAt.current = now
      setBackHint(true)
      hintTimer = window.setTimeout(() => setBackHint(false), 900)
    }).then(handle => { remove = () => void handle.remove() })
    return () => { remove(); window.clearTimeout(hintTimer) }
  }, [screen])
  const openDocument = async (id: string, page?: number, documentQuery?: string) => {
    const target = documents.find((item) => item.id === id) ?? (await documentsRepository.get(id))
    if (target?.isPrivate) {
      try {
        await appLockService.authenticate()
      } catch {
        return
      }
      const revealed = await documentsRepository.reveal(id)
      if (revealed) updateDocument(revealed)
    }
    open({ name: 'viewer', id, page, query: documentQuery })
  }
  const saveNewDocument = async (doc: VaultDocument) => {
    await documentsRepository.save(doc)
    setDocuments((current) => [doc, ...current.filter((item) => item.id !== doc.id)])
    setSearchResults((current) => [{ document: doc, score: 0, pageMatches: [] }, ...current.filter((result) => result.document.id !== doc.id)])
    open({ name: 'viewer', id: doc.id })
    window.setTimeout(
      () =>
        void processDocument(doc.id, updateDocument).catch(async (error) => {
          console.error('[processing] Deferred document processing failed', error)
          const latest = await documentsRepository.get(doc.id)
          if (latest) updateDocument(latest)
        }),
      0
    )
  }
  const preparePdfImport = async (onStage: (stage: string) => void) => {
    onStage('Choose a PDF from this device')
    const imported = await pdfImportService.pick()
    if (imported.cancelled) return null
    onStage(`Checking storage for ${imported.pages.length} page${imported.pages.length === 1 ? '' : 's'}`)
    const storage = await checkDocumentStorage(imported.pages)
    if (!storage.ok) throw new Error(storage.message || 'There is not enough free storage to import this PDF.')
    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      title: imported.title,
      titleSource: 'manual',
      folder: 'Unfiled',
      createdAt: now,
      updatedAt: now,
      status: 'ocr_pending',
      processingStage: 'ocr',
      pages: imported.pages,
      tags: []
    } satisfies VaultDocument
  }
  const combineSelectedDocuments = async (selected: VaultDocument[]) => {
    await withVisibleDocuments(selected, async (visible) => saveNewDocument(await combineDocuments(visible)))
  }
  const actionResult = async (result: VaultDocument, target: VaultDocument, saveMode: ActionSaveMode) => {
    if (saveMode === 'copy') return saveNewDocument(result)
    const oldPaths = [...new Set([...target.pages.flatMap((page) => [page.imagePath, page.originalImagePath, page.thumbnailPath, page.ocrImagePath]), target.pdfPath].filter((path): path is string => Boolean(path)))]
    const replacement: VaultDocument = {
      ...result,
      id: target.id,
      title: target.title,
      titleSource: target.titleSource,
      folder: target.folder,
      tags: [...target.tags],
      createdAt: target.createdAt,
      updatedAt: new Date().toISOString(),
      pdfPath: undefined,
      pdfGeneratedAt: undefined,
      isPrivate: Boolean(target.isPrivate || result.isPrivate)
    }
    await documentsRepository.save(replacement)
    const currentPaths = new Set([...replacement.pages.flatMap((page) => [page.imagePath, page.originalImagePath, page.thumbnailPath, page.ocrImagePath]), replacement.pdfPath].filter(Boolean))
    await Promise.all(oldPaths.filter((path) => !currentPaths.has(path)).map((path) => documentStorageService.removeFile(path)))
    updateDocument(replacement)
    open({ name: 'viewer', id: replacement.id })
    window.setTimeout(() => void processDocument(replacement.id, updateDocument).catch((error) => console.error('[processing] Replacement processing failed', error)), 0)
  }
  const withVisibleDocuments = async <T,>(selected: VaultDocument[], action: (documents: VaultDocument[]) => Promise<T>) => {
    if (selected.some((document) => document.isPrivate)) await appLockService.authenticate()
    const visible: VaultDocument[] = [],
      sessions: string[] = []
    try {
      for (const document of selected) {
        const ready = document.isPrivate ? await documentsRepository.reveal(document.id) : document
        if (!ready) throw new Error('A selected document is no longer available.')
        visible.push(ready)
        if (ready.privateSessionId) sessions.push(ready.privateSessionId)
      }
      return await action(visible)
    } finally {
      await Promise.all(sessions.map((session) => privateStorageService.clearSession(session)))
    }
  }
  const extractFromActions = async (document: VaultDocument, indexes: number[]) => withVisibleDocuments([document], async ([visible]) => saveNewDocument(await extractPages(visible, indexes)))
  const reorderFromActions = async (document: VaultDocument, indexes: number[], saveMode: ActionSaveMode) => withVisibleDocuments([document], async ([visible]) => actionResult(await reorderDocumentPages(visible, indexes), document, saveMode))
  const compressFromActions = async (document: VaultDocument, level: PdfCompressionLevel) =>
    withVisibleDocuments([document], async ([visible]) => {
      await downloadCompressedPdf(visible, level)
    })
  const insertFromActions = async (target: VaultDocument, source: VaultDocument, indexes: number[], at: number, saveMode: ActionSaveMode) => withVisibleDocuments([target, source], async ([visibleTarget, visibleSource]) => actionResult(await insertDocumentPages(visibleTarget, visibleSource, indexes, at), target, saveMode))
  const cleanFromActions = async (document: VaultDocument, indexes: number[], saveMode: ActionSaveMode) => withVisibleDocuments([document], async ([visible]) => actionResult(await removeDocumentPages(visible, indexes), document, saveMode))
  const analyseFromActions = async (document: VaultDocument) => withVisibleDocuments([document], async ([visible]) => analyseDocumentPages(visible))
  const exportTextFromActions = async (document: VaultDocument, format: 'txt' | 'md') => withVisibleDocuments([document], async ([visible]) => exportOcrText(visible, format))
  const renameFromActions = async (selected: VaultDocument[], template: string) => {
    if (selected.some((document) => document.isPrivate)) await appLockService.authenticate()
    const date = new Date().toISOString().slice(0, 10)
    const updated = selected.map((document, index) => ({
      ...document,
      title: template
        .replaceAll('{title}', document.title)
        .replaceAll('{n}', String(index + 1).padStart(2, '0'))
        .replaceAll('{date}', date)
        .replaceAll('{type}', document.smartMetadata?.documentType?.replaceAll('_', ' ') || 'document')
        .trim(),
      titleSource: 'manual' as const,
      updatedAt: new Date().toISOString()
    }))
    await Promise.all(updated.map((document) => documentsRepository.save(document)))
    const byId = new Map(updated.map((document) => [document.id, document]))
    setDocuments((current) => current.map((document) => byId.get(document.id) ?? document))
  }
  const bulkUpdateDocuments = async (ids: string[], action: { type: 'move' | 'tag' | 'privacy'; value: string | boolean }) => {
    const selectedIds = new Set(ids)
    const selected = documents.filter((document) => selectedIds.has(document.id))
    if (action.type === 'privacy') await appLockService.authenticate()
    const now = new Date().toISOString()
    const updated = selected.map((document) =>
      action.type === 'move'
        ? { ...document, folder: String(action.value), updatedAt: now }
        : action.type === 'tag'
          ? {
              ...document,
              tags: document.tags.some((tag) => tag.toLocaleLowerCase() === String(action.value).toLocaleLowerCase()) ? document.tags : [...document.tags, String(action.value)],
              updatedAt: now
            }
          : { ...document, isPrivate: Boolean(action.value), updatedAt: now }
    )
    await Promise.all(updated.map((document) => documentsRepository.save(document)))
    const updates = new Map(updated.map((document) => [document.id, document]))
    setDocuments((current) => current.map((document) => updates.get(document.id) ?? document))
    setSearchResults((current) => current.map((result) => (updates.has(result.document.id) ? { ...result, document: updates.get(result.document.id)! } : result)))
  }
  const bulkDeleteDocuments = async (ids: string[]) => {
    const deletedAt = new Date().toISOString()
    await Promise.all(
      documents
        .filter((document) => ids.includes(document.id))
        .map(async (document) => {
          await cancelProcessing(document.id, () => undefined).catch(() => undefined)
          await documentsRepository.save({
            ...document,
            deletedAt,
            updatedAt: deletedAt
          })
        })
    )
    const deleted = new Set(ids)
    setDocuments((current) => current.filter((document) => !deleted.has(document.id)))
    setSearchResults((current) => current.filter((result) => !deleted.has(result.document.id)))
  }

  if (lockState !== 'unlocked') return <AppLockScreen checking={lockState === 'checking'} onUnlock={() => void unlock()} />

  if (screen.name === 'capture') return <CaptureScreen onClose={() => open({ name: 'home' })} onSave={saveNewDocument} />
  if (screen.name === 'scanner-lab') return <ScannerLab onBack={() => open({ name: 'settings' })} />

  if (screen.name === 'viewer') {
    const document = documents.find((item) => item.id === screen.id)
    privateViewerId.current = document?.isPrivate ? screen.id : undefined
    return document ? (
      <Viewer
        document={document}
        initialPage={screen.page}
        initialQuery={screen.query}
        onBack={() => open({ name: 'home' })}
        onSaveCopy={async (copy) => {
          await documentsRepository.save(copy)
          setDocuments((current) => [copy, ...current])
          setSearchResults((current) => [{ document: copy, score: 0, pageMatches: [] }, ...current])
          open({ name: 'viewer', id: copy.id })
        }}
        onChange={async (updated) => {
          const previousSession = updated.privateSessionId
          await documentsRepository.save(updated)
          const visible = updated.isPrivate
            ? ((await documentsRepository.reveal(updated.id)) ?? updated)
            : await documentStorageService.hydrate({
                ...updated,
                privateSessionId: undefined,
                privatePdfPath: undefined
              })
          if (previousSession && previousSession !== visible.privateSessionId) await privateStorageService.clearSession(previousSession)
          updateDocument(visible)
        }}
        onDelete={async () => {
          const deletedAt = new Date().toISOString()
          await cancelProcessing(document.id, () => undefined).catch(() => undefined)
          await documentsRepository.save({
            ...document,
            deletedAt,
            updatedAt: deletedAt
          })
          await refresh()
          open({ name: 'home' })
        }}
      />
    ) : (
      <EmptyLoading />
    )
  }

  privateViewerId.current = undefined

  return (
    <div className="app-shell">
      <main className="content">
        {screen.name === 'home' && <Library documents={searchResults.map((result) => result.document)} allDocuments={documents} searchResults={searchResults} query={query} setQuery={setQuery} searchFilter={searchFilter} setSearchFilter={setSearchFilter} loading={loading} onScan={() => open({ name: 'capture' })} onPrepareImport={preparePdfImport} onCommitImport={saveNewDocument} onBulkUpdate={bulkUpdateDocuments} onBulkDelete={bulkDeleteDocuments} onOpen={(id, page) => void openDocument(id, page, parseAdvancedQuery(query).text)} />}
        {screen.name === 'folders' && <Folders documents={documents} onOpen={(id) => void openDocument(id)} onChange={refresh} />}
        {screen.name === 'actions' && <ActionsScreen documents={documents} onCombine={combineSelectedDocuments} onExtract={extractFromActions} onReorder={reorderFromActions} onCompress={compressFromActions} onInsert={insertFromActions} onClean={cleanFromActions} onAnalyse={analyseFromActions} onRename={renameFromActions} onExportText={exportTextFromActions} />}
        {screen.name === 'settings' && <SettingsScreen documents={documents} onChanged={refresh} onOpenTrash={() => open({ name: 'trash' })} />}
        {screen.name === 'trash' && <TrashScreen onBack={() => open({ name: 'settings' })} onChanged={refresh} />}
      </main>
    <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton active={screen.name === 'home'} icon={<Home />} label="Library" onClick={() => open({ name: 'home' })} />
        <NavButton active={screen.name === 'folders'} icon={<Folder />} label="Folders" onClick={() => open({ name: 'folders' })} />
        <button className="nav-tab scan-tab" onClick={() => open({ name: 'capture' })} aria-label="Scan document">
          <span className="nav-icon">
            <ScanLine />
          </span>
          <span className="nav-label">Scan</span>
        </button>
        <NavButton active={screen.name === 'actions'} icon={<Files />} label="Actions" onClick={() => open({ name: 'actions' })} />
        <NavButton active={screen.name === 'settings'} icon={<Settings />} label="Settings" onClick={() => open({ name: 'settings' })} />
    </nav>
    {backHint ? <div className="back-hint" role="status">Press Back again to minimize LOCAL</div> : null}
  </div>
  )
}

const SEARCH_FILTERS: { id: SmartSearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'this_month', label: 'This month' },
  { id: 'bills', label: 'Bills' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'prescriptions', label: 'Prescriptions' },
  { id: 'statements', label: 'Statements' },
  { id: 'needs_attention', label: 'Needs attention' }
]
function Library({ documents, allDocuments, searchResults, query, setQuery, searchFilter, setSearchFilter, loading, onScan, onPrepareImport, onCommitImport, onBulkUpdate, onBulkDelete, onOpen }: { documents: VaultDocument[]; allDocuments: VaultDocument[]; searchResults: DocumentSearchResult[]; query: string; setQuery: (value: string) => void; searchFilter: SmartSearchFilter; setSearchFilter: (value: SmartSearchFilter) => void; loading: boolean; onScan: () => void; onPrepareImport: (onStage: (stage: string) => void) => Promise<VaultDocument | null>; onCommitImport: (document: VaultDocument) => Promise<void>; onBulkUpdate: (ids: string[], action: { type: 'move' | 'tag' | 'privacy'; value: string | boolean }) => Promise<void>; onBulkDelete: (ids: string[]) => Promise<void>; onOpen: (id: string, page?: number) => void }) {
  const resultsById = useMemo(() => new Map(searchResults.map((result) => [result.document.id, result])), [searchResults])
  const highlightQuery = useMemo(() => parseAdvancedQuery(query).text, [query])
  const [importing, setImporting] = useState(false),
    [importError, setImportError] = useState(''),
    [importStatus, setImportStatus] = useState(''),
    [pendingImport, setPendingImport] = useState<VaultDocument | null>(null)
  const [selecting, setSelecting] = useState(false),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [bulkMode, setBulkMode] = useState<BulkEditMode | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false),
    [bulkError, setBulkError] = useState(''),
    [searchHelp, setSearchHelp] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => localStorage.getItem('local.library.view') === 'grid' ? 'grid' : 'list')
  const [sortOrder, setSortOrder] = useState<'recent' | 'oldest' | 'title' | 'pages'>('recent')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [folderFilter, setFolderFilter] = useState('All folders'), [tagFilter, setTagFilter] = useState('All tags'), [privacyFilter, setPrivacyFilter] = useState<'all' | 'public' | 'private'>('all')
  const [recentSearches, setRecentSearches] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('local.library.recent-searches') ?? '[]') as string[] } catch { return [] } })
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedDocuments = useMemo(() => documents.filter((document) => selectedIdSet.has(document.id)), [documents, selectedIdSet])
  const processingDocuments = useMemo(() => allDocuments.filter((document) => document.status !== 'indexed').slice(0, 4), [allDocuments])
  const folders = useMemo(() => ['All folders', ...new Set(allDocuments.map(document => document.folder))], [allDocuments])
  const tags = useMemo(() => ['All tags', ...new Set(allDocuments.flatMap(document => document.tags))], [allDocuments])
  const displayDocuments = useMemo(() => documents.filter(document => (folderFilter === 'All folders' || document.folder === folderFilter) && (tagFilter === 'All tags' || document.tags.includes(tagFilter)) && (privacyFilter === 'all' || Boolean(document.isPrivate) === (privacyFilter === 'private'))).sort((a, b) => sortOrder === 'title' ? a.title.localeCompare(b.title) : sortOrder === 'pages' ? b.pages.length - a.pages.length : sortOrder === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)), [documents, folderFilter, tagFilter, privacyFilter, sortOrder])
  const activeVisualFilters = [folderFilter !== 'All folders', tagFilter !== 'All tags', privacyFilter !== 'all'].filter(Boolean).length
  useEffect(() => { if (query.trim().length < 3) return; const timer = window.setTimeout(() => { setRecentSearches(current => { const next = [query.trim(), ...current.filter(value => value.toLocaleLowerCase() !== query.trim().toLocaleLowerCase())].slice(0, 5); localStorage.setItem('local.library.recent-searches', JSON.stringify(next)); return next }) }, 900); return () => window.clearTimeout(timer) }, [query])
  useEffect(() => {
    const back = (raw: Event) => {
      if (filtersOpen) setFiltersOpen(false)
      else if (pendingImport) setPendingImport(null)
      else if (deleteConfirm) setDeleteConfirm(false)
      else if (bulkMode) setBulkMode(null)
      else if (selecting) { setSelecting(false); setSelectedIds([]); setBulkMode(null); setBulkError('') }
      else return
      raw.preventDefault()
    }
    window.addEventListener('local:back', back)
    return () => window.removeEventListener('local:back', back)
  }, [filtersOpen, pendingImport, deleteConfirm, bulkMode, selecting])
  const clearSelection = useCallback(() => {
    setSelecting(false)
    setSelectedIds([])
    setBulkMode(null)
    setBulkError('')
  }, [])
  const toggleSelected = (id: string) => setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  const applyBulk = async (type: 'move' | 'tag' | 'privacy', value: string | boolean) => {
    setBulkBusy(true)
    setBulkError('')
    try {
      await onBulkUpdate(selectedIds, { type, value })
      clearSelection()
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Could not update the selected documents.')
    } finally {
      setBulkBusy(false)
    }
  }
  const deleteBulk = async () => {
    setDeleteConfirm(false)
    setBulkBusy(true)
    setBulkError('')
    try {
      await onBulkDelete(selectedIds)
      clearSelection()
    } catch {
      setBulkError('Could not delete all selected documents.')
    } finally {
      setBulkBusy(false)
    }
  }
  const importPdf = async () => {
    setImporting(true)
    setImportError('')
    setImportStatus('Opening document picker…')
    try {
      const prepared = await onPrepareImport(setImportStatus)
      if (prepared) setPendingImport(prepared)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not import this PDF.')
    } finally {
      setImporting(false)
      setImportStatus('')
    }
  }
  const commitImport = async () => {
    if (!pendingImport) return
    const prepared = pendingImport
    setPendingImport(null)
    setImporting(true)
    setImportStatus('Saving securely on this device…')
    try {
      await onCommitImport(prepared)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The PDF could not be saved.')
      setImporting(false)
      setImportStatus('')
    }
  }
  return (
    <>
      <header className="home-header">
        <div className="brand-mark">
          <Archive size={22} />
        </div>
        <div>
          <h1>LOCAL</h1>
          <p>Local OCR, Capture, Archive &amp; Lookup</p>
        </div>
        <div className="privacy-chip">
          <ShieldCheck size={15} /> On-device
        </div>
      </header>
      <section className="hero">
        <div className="eyebrow">Your private document cabinet</div>
        <h2>
          Find any paper,
          <br />
          <em>right when you need it.</em>
        </h2>
        <p>Scan, organise and search every document. Nothing leaves this device.</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={onScan}>
            <Camera />
            <span>Scan a document</span>
          </button>
          <button className="import-pdf-button" disabled={importing} onClick={() => void importPdf()}>
            {importing ? <span className="button-spinner" /> : <FileUp />}
            <span>{importing ? 'Importing locally…' : 'Import PDF'}</span>
          </button>
        </div>
        {importError && (
          <p className="hero-error" role="alert">
            {importError}
          </p>
        )}
        {importStatus ? (
          <p className="import-status" role="status">
            <span className="button-spinner" /> {importStatus}
          </p>
        ) : null}
      </section>
      {processingDocuments.length ? (
        <section className="processing-centre" aria-label="Document processing">
          <header>
            <div>
              <strong>Processing centre</strong>
              <small>On-device work continues in the background</small>
            </div>
            <span>{processingDocuments.length}</span>
          </header>
          {processingDocuments.map((document) => {
            const complete = document.pages.filter((page) => page.ocrState === 'complete').length
            const percent = document.pages.length ? Math.round((complete / document.pages.length) * 100) : 0
            return (
              <button key={document.id} onClick={() => onOpen(document.id)}>
                <div>
                  <strong>{document.isPrivate ? 'Private document' : document.title}</strong>
                  <small>{statusLabel(document)}</small>
                </div>
                <span>{document.status === 'error' ? 'Needs attention' : `${percent}%`}</span>
                <i>
                  <b style={{ width: `${percent}%` }} />
                </i>
              </button>
            )
          })}
        </section>
      ) : null}
      <div className="search-field">
        <Search size={20} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search text or use filters" aria-label="Search documents" />
        {query ? (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={18} />
          </button>
        ) : null}
        <button onClick={() => setSearchHelp((open) => !open)} aria-label="Advanced search help" aria-expanded={searchHelp}>
          <CircleHelp size={18} />
        </button>
      </div>
      {!query && recentSearches.length ? <div className="recent-searches"><span>Recent</span>{recentSearches.map(value => <button key={value} onClick={() => setQuery(value)}><Clock3 /> {value}</button>)}<button className="clear" onClick={() => { setRecentSearches([]); localStorage.removeItem('local.library.recent-searches') }}>Clear</button></div> : null}
      {searchHelp ? (
        <aside className="search-help">
          <strong>Advanced search</strong>
          <span>Combine normal words with filters:</span>
          <div>
            {['type:invoice', 'folder:"Tax records"', 'tag:important', 'amount:>5000', 'after:2026-01', 'private:true'].map((example) => (
              <button key={example} onClick={() => setQuery(normaliseQuery(`${query} ${example}`))}>
                {example}
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="smart-filter-strip" aria-label="Document filters">
        {SEARCH_FILTERS.map((filter) => (
          <button key={filter.id} className={searchFilter === filter.id ? 'active' : ''} aria-pressed={searchFilter === filter.id} onClick={() => setSearchFilter(filter.id)}>
            {filter.label}
          </button>
        ))}
      </div>
      <div className="library-view-tools"><button onClick={() => setFiltersOpen(true)}><SlidersHorizontal /> Filters{activeVisualFilters ? ` (${activeVisualFilters})` : ''}</button><label>Sort<select value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)}><option value="recent">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option><option value="pages">Most pages</option></select></label><div role="group" aria-label="Library view"><button className={viewMode === 'list' ? 'active' : ''} onClick={() => { setViewMode('list'); localStorage.setItem('local.library.view', 'list') }} aria-label="List view" aria-pressed={viewMode === 'list'}><List /></button><button className={viewMode === 'grid' ? 'active' : ''} onClick={() => { setViewMode('grid'); localStorage.setItem('local.library.view', 'grid') }} aria-label="Grid view" aria-pressed={viewMode === 'grid'}><Grid2X2 /></button></div></div>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <span>{selecting ? `${selectedIds.length} selected` : query || searchFilter !== 'all' ? 'Matching documents' : 'Recent documents'}</span>
            <small>
              {displayDocuments.length} {displayDocuments.length === 1 ? 'document' : 'documents'}
            </small>
          </div>
          <div className="section-tools">
            {selecting ? (
              <button onClick={clearSelection}>Cancel</button>
            ) : (
              <>
                {searchFilter !== 'all' ? <button onClick={() => setSearchFilter('all')}>Clear filter</button> : null}
                {displayDocuments.length ? (
                  <button onClick={() => setSelecting(true)}>
                    <Check /> Select
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
        {loading ? (
          <EmptyLoading />
        ) : displayDocuments.length ? (
          <div className={`document-list ${viewMode === 'grid' ? 'document-grid-view' : ''}${selecting ? ' selecting' : ''}`}>
            {displayDocuments.map((document) => {
              const match = resultsById.get(document.id)?.pageMatches[0]
              return <DocumentRow key={document.id} document={document} match={match} query={highlightQuery} selecting={selecting} selected={selectedIdSet.has(document.id)} onClick={() => (selecting ? toggleSelected(document.id) : onOpen(document.id, match?.pageIndex))} />
            })}
          </div>
        ) : (
          <EmptyLibrary onScan={onScan} searching={Boolean(query || searchFilter !== 'all' || activeVisualFilters)} />
        )}
      </section>
      {filtersOpen ? <div className="tool-sheet-layer" role="presentation" onClick={() => setFiltersOpen(false)}><section className="tool-sheet library-filter-sheet" role="dialog" aria-modal="true" aria-label="Filter library" onClick={event => event.stopPropagation()}><header><div><SlidersHorizontal /><span><strong>Filter library</strong><small>Choose visible document properties</small></span></div><button onClick={() => setFiltersOpen(false)} aria-label="Close"><X /></button></header><label>Folder<select value={folderFilter} onChange={event => setFolderFilter(event.target.value)}>{folders.map(folder => <option key={folder}>{folder}</option>)}</select></label><label>Tag<select value={tagFilter} onChange={event => setTagFilter(event.target.value)}>{tags.map(tag => <option key={tag}>{tag}</option>)}</select></label><fieldset><legend>Privacy</legend>{(['all','public','private'] as const).map(value => <button key={value} className={privacyFilter === value ? 'selected' : ''} onClick={() => setPrivacyFilter(value)} aria-pressed={privacyFilter === value}>{value === 'all' ? 'All' : value === 'public' ? 'Standard' : 'Private'}</button>)}</fieldset><div className="filter-sheet-actions"><button onClick={() => { setFolderFilter('All folders'); setTagFilter('All tags'); setPrivacyFilter('all') }}>Clear all</button><button onClick={() => setFiltersOpen(false)}>Show {displayDocuments.length} documents</button></div></section></div> : null}
      <div className="privacy-note">
        <LockKeyhole size={18} />
        <div>
          <strong>Private by design</strong>
          <span>Your files and searches stay entirely on this device.</span>
        </div>
      </div>
      {selecting && selectedIds.length > 0 ? <BulkActionBar count={selectedIds.length} busy={bulkBusy} error={bulkError} allPrivate={selectedDocuments.every((document) => document.isPrivate)} onMove={() => setBulkMode('move')} onTag={() => setBulkMode('tag')} onPrivacy={() => void applyBulk('privacy', !selectedDocuments.every((document) => document.isPrivate))} onDelete={() => setDeleteConfirm(true)} onCancel={clearSelection} /> : null}
      {bulkMode ? <BulkOrganizeSheet mode={bulkMode} count={selectedIds.length} busy={bulkBusy} error={bulkError} onClose={() => setBulkMode(null)} onApply={(value) => void applyBulk(bulkMode, value)} /> : null}
      {deleteConfirm ? <ConfirmSheet title={`Move ${selectedIds.length} document${selectedIds.length === 1 ? '' : 's'} to Recently Deleted?`} message="You can restore them for 30 days before they are permanently removed." confirmLabel="Move to Recently Deleted" onConfirm={() => void deleteBulk()} onCancel={() => setDeleteConfirm(false)} /> : null}
      {pendingImport ? <ConfirmSheet title={`Import “${pendingImport.title}”?`} message={`${pendingImport.pages.length} page${pendingImport.pages.length === 1 ? '' : 's'} will be copied into LOCAL, then searchable text will be prepared in the background.`} confirmLabel="Import PDF" onConfirm={() => void commitImport()} onCancel={() => setPendingImport(null)} /> : null}
    </>
  )
}

const normaliseQuery = (value: string) => value.replace(/\s+/g, ' ').trim()

function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean),
    lowerTerms = new Set(terms.map((term) => term.toLocaleLowerCase()))
  return <>{text.split(/(\s+)/).map((part, index) => (lowerTerms.has(part.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase()) ? <mark key={index}>{part}</mark> : part))}</>
}
function DocumentRow({ document, match, query = '', selecting = false, selected = false, onClick }: { document: VaultDocument; match?: DocumentSearchResult['pageMatches'][number]; query?: string; selecting?: boolean; selected?: boolean; onClick: () => void }) {
  return (
    <button className={`document-row${selected ? ' selected' : ''}`} onClick={onClick} aria-pressed={selecting ? selected : undefined}>
      {match && !document.isPrivate && <span className="match-page-badge">Page {match.pageIndex + 1}</span>}
      {selecting ? <span className="row-selector">{selected ? <Check /> : null}</span> : null}
      <div className={`doc-thumb${document.isPrivate ? ' private' : ''}`}>{document.isPrivate ? <Lock /> : document.pages[0]?.thumbnailUrl || document.pages[0]?.imageUrl ? <img src={document.pages[0].thumbnailUrl || document.pages[0].imageUrl} alt="" /> : <FileText />}</div>
      <div className="doc-main">
        <strong>{document.isPrivate ? 'Private document' : document.title}</strong>
        <span>
          {formatDate(document.createdAt)} · {document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'}
          {document.isPrivate ? ' · Locked' : ''}
        </span>
        {match && !document.isPrivate ? (
          <span className="search-snippet">
            <HighlightedText text={match.snippet} query={query} />
          </span>
        ) : (
          <small className={document.status === 'error' ? 'status error' : 'status'}>
            <i />
            {document.isPrivate ? 'Authenticate to open' : statusLabel(document)}
          </small>
        )}
      </div>
      {selecting ? null : <ChevronRight className="row-arrow" size={20} />}
    </button>
  )
}

function EmptyLibrary({ onScan, searching }: { onScan: () => void; searching: boolean }) {
  return (
    <div className="empty-state">
      <div>
        <FileText />
      </div>
      <h3>{searching ? 'No matching documents' : 'Your cabinet is empty'}</h3>
      <p>{searching ? 'Try another word or phrase.' : 'Scan your first document to make it searchable and easy to find.'}</p>
      {!searching && (
        <button className="secondary-button" onClick={onScan}>
          <Camera size={18} /> Scan now
        </button>
      )}
    </div>
  )
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
  const [folderOptions, setFolderOptions] = useState(['Unfiled'])
  const [cameraOpen, setCameraOpen] = useState(true)
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null)
  const draggedPageIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void documentsRepository
      .list()
      .then((documents) => folderService.list(documents))
      .then(setFolderOptions)
      .catch(() => setFolderOptions(['Unfiled']))
  }, [])
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setProcessing(true)
    setCaptureError('')
    try {
      const addedPages = await filesToPages(files)
      setPages((current) => [...current, ...addedPages])
      setSelectedPageId(addedPages.at(-1)?.id ?? null)
    } catch {
      setCaptureError('One or more pages could not be processed. Please try capturing them again.')
    } finally {
      setProcessing(false)
    }
  }
  const rotate = (id: string) => setPages((current) => current.map((page) => (page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page)))
  const movePage = (index: number, direction: -1 | 1) =>
    setPages((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const reordered = [...current]
      ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
      return reordered
    })
  const movePageTo = (pageId: string, targetId: string) =>
    setPages((current) => {
      const from = current.findIndex((page) => page.id === pageId)
      const to = current.findIndex((page) => page.id === targetId)
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
    setProcessing(true)
    setCaptureError('')
    try {
      const enhanced: DocumentPage[] = []
      for (const page of pages) {
        const result = await processPageImages(page.originalImageUrl ?? page.imageUrl, page.corners ?? defaultCorners, 'auto', defaultAdjustments)
        enhanced.push({
          ...page,
          ...result,
          renderPreset: 'auto',
          adjustments: defaultAdjustments,
          processingState: 'processed',
          ocrState: 'pending',
          ocrText: ''
        })
      }
      setPages(enhanced)
    } catch (error) {
      console.error('Enhancing all pages failed', error)
      setCaptureError('One or more pages could not be enhanced. Your existing pages are unchanged.')
    } finally {
      setProcessing(false)
    }
  }
  const savePages = async (pagesToSave: DocumentPage[]) => {
    const now = new Date().toISOString()
    setSaving(true)
    setCaptureError('')
    try {
      console.info('[capture] save requested', {
        pageCount: pagesToSave.length,
        folder
      })
      const storage = await checkDocumentStorage(pagesToSave)
      if (!storage.ok) {
        setCaptureError(storage.message || 'Not enough free storage to save this document.')
        setSaving(false)
        return false
      }
      await onSave({
        id: crypto.randomUUID(),
        title: `Scanned document · ${formatDate(now)}`,
        titleSource: 'automatic',
        folder,
        createdAt: now,
        updatedAt: now,
        status: 'ocr_pending',
        processingStage: 'ocr',
        pages: pagesToSave,
        tags: []
      })
      console.info('[capture] save handoff completed', {
        pageCount: pagesToSave.length
      })
      return true
    } catch (error) {
      console.error('[capture] save failed', error)
      setCaptureError('This document could not be saved. Check available device storage and try again.')
      setSaving(false)
      return false
    }
  }
  const save = async () => {
    await savePages(pages)
  }
  const editingPage = pages.find((page) => page.id === editingPageId)
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0]
  const selectedIndex = selectedPage ? pages.indexOf(selectedPage) : -1
  const editSelected = (mode: 'crop' | 'preview') => {
    if (!selectedPage) return
    setEditingMode(mode)
    setEditingPageId(selectedPage.id)
  }
  const deleteSelected = () => {
    if (!selectedPage) return
    const remaining = pages.filter((page) => page.id !== selectedPage.id)
    setPages(remaining)
    setSelectedPageId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null)
    if (!remaining.length) setCameraOpen(true)
  }
  const closeScanner = () => (pages.length ? setCameraOpen(false) : onClose())
  const completeNativeScan = async (files: File[]) => {
    setProcessing(true)
    setCaptureError('')
    try {
      console.info('[scanner] preparing returned ML Kit pages', {
        fileCount: files.length,
        existingPageCount: pages.length
      })
      const captured = await nativeScansToPages(files)
      setPages((currentPages) => [...currentPages, ...captured])
      setSelectedPageId(captured.at(-1)?.id ?? null)
      setCameraOpen(false)
      console.info('[scanner] returned ML Kit pages ready for review', {
        pageCount: captured.length
      })
    } catch (error) {
      console.error('[scanner] returned ML Kit pages could not be prepared', error)
      setCaptureError('The scanned pages could not be prepared. Please try scanning them again.')
      throw error
    } finally {
      setProcessing(false)
    }
  }
  if (editingPage)
    return (
      <ScanPageEditor
        page={editingPage}
        pageNumber={pages.indexOf(editingPage) + 1}
        initialMode={editingMode}
        onCancel={() => setEditingPageId(null)}
        onSave={(updated) => {
          setPages((current) => current.map((page) => (page.id === updated.id ? updated : page)))
          setEditingPageId(null)
        }}
      />
    )
  if (cameraOpen && nativeDocumentScannerService.available()) return <NativeDocumentScanner onCancel={closeScanner} onComplete={completeNativeScan} />
  if (cameraOpen)
    return (
      <InAppCamera
        pageCount={pages.length}
        latestPageUrl={pages.at(-1)?.thumbnailUrl || pages.at(-1)?.imageUrl}
        onClose={closeScanner}
        onDone={() => {
          setSelectedPageId(pages.at(-1)?.id ?? null)
          setCameraOpen(false)
        }}
        onRetake={() =>
          setPages((currentPages) => {
            const remaining = currentPages.slice(0, -1)
            setSelectedPageId(remaining.at(-1)?.id ?? null)
            return remaining
          })
        }
        onImport={() => {
          setCameraOpen(false)
          setTimeout(() => inputRef.current?.click())
        }}
        onCapture={async (file, proposed) => {
          setProcessing(true)
          setCaptureError('')
          try {
            const captured = await filesToPages([file], proposed)
            setPages((currentPages) => [...currentPages, ...captured])
            setSelectedPageId(captured.at(-1)?.id ?? null)
          } catch {
            setCaptureError('The captured page could not be processed. Please try again.')
          } finally {
            setProcessing(false)
          }
        }}
      />
    )

  return (
    <div className="full-screen capture-review-screen">
      <header className="top-bar">
        <button onClick={onClose} aria-label="Cancel">
          <X />
        </button>
        <div>
          <strong>New scan</strong>
          <span>{saving ? 'Saving safely on this device…' : processing ? 'Finding document edges…' : pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} captured` : 'Add your pages'}</span>
        </div>
        <button className="text-action" disabled={!pages.length || processing || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>
      {!pages.length ? (
        <section className="capture-empty">
          <div className="viewfinder">
            <span />
            <span />
            <span />
            <span />
            <FileText />
          </div>
          <h2>Ready to scan</h2>
          <p>Place the document on a flat surface with good lighting.</p>
          <button className="primary-button" onClick={() => setCameraOpen(true)}>
            <Camera /> Open LOCAL camera
          </button>
          <button className="secondary-button" onClick={() => inputRef.current?.click()}>
            <Upload /> Import photos
          </button>
        </section>
      ) : (
        <>
          <section className="scan-review-heading">
            <div>
              <strong>Review your scan</strong>
              <span>{pages.length > 1 ? 'Auto-enhanced · drag handles to reorder' : 'Auto-enhanced · tap to refine borders'}</span>
            </div>
            <label>
              Folder
              <select value={folder} onChange={(event) => setFolder(event.target.value)}>
                {folderOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          </section>
          {selectedPage ? (
            <section className="scan-review">
              <button className="scan-review-preview" onClick={() => editSelected('crop')} aria-label={`Adjust page ${selectedIndex + 1}`}>
                <img src={selectedPage.imageUrl} alt={`Page ${selectedIndex + 1}`} style={{ transform: `rotate(${selectedPage.rotation}deg)` }} />
                {selectedPage.processingState === 'needs_review' ? <span>Check borders</span> : null}
              </button>
              <div className="review-order">
                <button onClick={() => movePage(selectedIndex, -1)} disabled={selectedIndex <= 0} aria-label="Move page earlier">
                  <ArrowLeft />
                </button>
                <span>
                  Page {selectedIndex + 1} of {pages.length}
                </span>
                <button onClick={() => movePage(selectedIndex, 1)} disabled={selectedIndex >= pages.length - 1} aria-label="Move page later">
                  <ChevronRight />
                </button>
              </div>
            </section>
          ) : null}
          <section className="review-thumbnails" aria-label="Captured pages">
            {pages.map((page, index) => (
              <div key={page.id} data-page-id={page.id} className={`review-thumbnail${page.id === selectedPage?.id ? ' active' : ''}${page.id === draggingPageId ? ' dragging' : ''}`}>
                <button onClick={() => setSelectedPageId(page.id)} aria-label={`Open page ${index + 1}`}>
                  <img src={page.thumbnailUrl || page.imageUrl} alt="" />
                  <span>{index + 1}</span>
                </button>
                {pages.length > 1 ? (
                  <span className="page-drag-handle" role="button" tabIndex={0} aria-label={`Reorder page ${index + 1}. Use left and right arrow keys, or drag.`} onKeyDown={(event) => reorderWithKeyboard(event, index)} onPointerDown={(event) => beginPageDrag(event, page.id)} onPointerMove={continuePageDrag} onPointerUp={endPageDrag} onPointerCancel={endPageDrag}>
                    <GripVertical />
                  </span>
                ) : null}
              </div>
            ))}
          </section>
          <nav className="scan-review-toolbar" aria-label="Page editing tools">
            <button disabled={processing} onClick={() => setCameraOpen(true)}>
              <ImagePlus />
              <span>Add</span>
            </button>
            <button disabled={processing} onClick={() => editSelected('crop')}>
              <Crop />
              <span>Crop</span>
            </button>
            <button disabled={processing} onClick={() => selectedPage && rotate(selectedPage.id)}>
              <RotateCw />
              <span>Rotate</span>
            </button>
            <button disabled={processing} onClick={() => void enhanceAllPages()}>
              <ScanLine />
              <span>Enhance all</span>
            </button>
            <button disabled={processing} className="danger" onClick={deleteSelected}>
              <Trash2 />
              <span>Delete</span>
            </button>
          </nav>
          {processing && (
            <div className="page-processing">
              <span className="button-spinner" /> Processing each page on this device…
            </div>
          )}
          {captureError && (
            <div className="scanner-error" role="alert">
              {captureError}
            </div>
          )}
        </>
      )}
      <input ref={inputRef} className="hidden-input" type="file" accept="image/*" multiple onChange={(event) => void addFiles(event.target.files)} />
    </div>
  )
}

function Viewer({ document, initialPage = 0, initialQuery = '', onBack, onChange, onSaveCopy, onDelete }: { document: VaultDocument; initialPage?: number; initialQuery?: string; onBack: () => void; onChange: (doc: VaultDocument) => Promise<void>; onSaveCopy: (doc: VaultDocument) => Promise<void>; onDelete: () => void }) {
  const savedReadingState = useMemo(() => viewerStateService.read(document.id), [document.id])
  const restoredPage = initialQuery || initialPage > 0 ? initialPage : savedReadingState.page
  const [page, setPage] = useState(Math.min(Math.max(restoredPage, 0), Math.max(0, document.pages.length - 1)))
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
  const [actionView, setActionView] = useState<'main' | 'folder' | 'password' | 'private' | 'tags' | 'text'>('main')
  const [customFolder, setCustomFolder] = useState('')
  const [folderOptions, setFolderOptions] = useState<string[]>(['Unfiled'])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [pdfPassword, setPdfPassword] = useState('')
  const [pdfPasswordConfirm, setPdfPasswordConfirm] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [readingMode, setReadingMode] = useState<'single' | 'continuous' | 'facing' | 'text'>(savedReadingState.mode)
  const [viewerTheme, setViewerTheme] = useState(savedReadingState.theme)
  const [keepAwake, setKeepAwake] = useState(savedReadingState.keepAwake)
  const [trimMargins, setTrimMargins] = useState(savedReadingState.trimMargins)
  const [bookmarks, setBookmarks] = useState(savedReadingState.bookmarks.filter(value => value < document.pages.length))
  const [chromeVisible, setChromeVisible] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const annotationOpenRef = useRef(false)
  annotationOpenRef.current = annotationOpen
  const [annotationMode, setAnnotationMode] = useState<'pan' | 'pen' | 'highlighter' | 'eraser'>('pan')
  const [annotationColor, setAnnotationColor] = useState('#d32f2f')
  const [annotationWidth, setAnnotationWidth] = useState(.006)
  const [annotationsVisible, setAnnotationsVisible] = useState(true)
  const [annotationDraft, setAnnotationDraft] = useState<Record<string, AnnotationStroke[]>>(() => Object.fromEntries(document.pages.map(item => [item.id, item.annotations?.strokes ?? []])))
  const [annotationUndo, setAnnotationUndo] = useState<Record<string, AnnotationStroke[][]>>({})
  const [annotationRedo, setAnnotationRedo] = useState<Record<string, AnnotationStroke[][]>>({})
  const [annotationSaveOpen, setAnnotationSaveOpen] = useState(false)
  const [annotationBusy, setAnnotationBusy] = useState(false)
  const [annotationError, setAnnotationError] = useState('')
  const [annotationNotice, setAnnotationNotice] = useState('')
  const annotationDraftRef = useRef(annotationDraft)
  const annotationAutosaveTimer = useRef(0)
  const annotationAutosavePending = useRef<Promise<void>>(Promise.resolve())
  const readingState = useRef<ViewerReadingState>({ ...savedReadingState, page: Math.min(Math.max(restoredPage, 0), Math.max(0, document.pages.length - 1)) })
  const readingStateTimer = useRef(0)
  const saveReadingState = useCallback((changes: Partial<ViewerReadingState>) => {
    readingState.current = { ...readingState.current, ...changes }
    window.clearTimeout(readingStateTimer.current)
    readingStateTimer.current = window.setTimeout(() => viewerStateService.write(document.id, readingState.current), 180)
  }, [document.id])
  useEffect(() => () => {
    window.clearTimeout(readingStateTimer.current)
    viewerStateService.write(document.id, readingState.current)
  }, [document.id])
  useEffect(() => { saveReadingState({ page, mode: readingMode }) }, [page, readingMode, saveReadingState])
  useEffect(() => { saveReadingState({ theme: viewerTheme, keepAwake, trimMargins, bookmarks }) }, [viewerTheme, keepAwake, trimMargins, bookmarks, saveReadingState])
  const saveSingleView = useCallback((single: ViewerReadingState['single']) => saveReadingState({ single }), [saveReadingState])
  const saveContinuousView = useCallback((continuous: ViewerReadingState['continuous']) => saveReadingState({ continuous }), [saveReadingState])
  const chromeTimer = useRef(0)
  const revealChrome = useCallback(() => {
    setChromeVisible(true)
    window.clearTimeout(chromeTimer.current)
    chromeTimer.current = window.setTimeout(() => setChromeVisible(false), 3200)
  }, [])
  useEffect(() => { revealChrome(); return () => window.clearTimeout(chromeTimer.current) }, [page, readingMode, revealChrome])
  useEffect(() => {
    if (!keepAwake) return
    let lock: { release(): Promise<void> } | undefined
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
    void wakeLock?.request('screen').then(value => { lock = value }).catch(() => undefined)
    return () => { void lock?.release() }
  }, [keepAwake])
  const toggleBookmark = () => setBookmarks(current => current.includes(page) ? current.filter(value => value !== page) : [...current, page].sort((a, b) => a - b))
  const goToPage = (requested: number) => {
    const next = Math.max(0, Math.min(document.pages.length - 1, requested))
    setPage(next); revealChrome()
  }
  const toggleReadAloud = () => {
    if (!('speechSynthesis' in window)) return
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return }
    const text = document.pages.slice(page).map((item, index) => `Page ${page + index + 1}. ${item.ocrText}`).join('\n')
    if (!text.trim()) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true); window.speechSynthesis.speak(utterance)
  }
  const documentWithAnnotations = (draft: Record<string, AnnotationStroke[]>) => ({
    ...document,
    pages: document.pages.map(item => ({ ...item, annotations: { version: 1 as const, strokes: draft[item.id] ?? [] } }))
  })
  const queueAnnotationAutosave = (draft: Record<string, AnnotationStroke[]>) => {
    annotationDraftRef.current = draft
    window.clearTimeout(annotationAutosaveTimer.current)
    annotationAutosaveTimer.current = window.setTimeout(() => {
      const durableDraft = { ...documentWithAnnotations(annotationDraftRef.current), pdfPath: undefined, privatePdfPath: undefined, pdfGeneratedAt: undefined, pdfPasswordProtected: false, updatedAt: new Date().toISOString() }
      annotationAutosavePending.current = onChange(durableDraft).then(() => { setAnnotationNotice('Draft saved') }).catch(() => { setAnnotationNotice('Draft save will retry when you tap Done') })
    }, 700)
  }
  useEffect(() => () => {
    window.clearTimeout(annotationAutosaveTimer.current)
    if (annotationOpenRef.current) void onChange({ ...documentWithAnnotations(annotationDraftRef.current), pdfPath: undefined, privatePdfPath: undefined, pdfGeneratedAt: undefined, pdfPasswordProtected: false, updatedAt: new Date().toISOString() })
  }, [document.id])
  const changeAnnotations = (pageId: string, strokes: AnnotationStroke[]) => {
    setAnnotationDraft(current => {
      const previous = current[pageId] ?? []
      if (strokes.length !== previous.length) {
        setAnnotationUndo(history => ({ ...history, [pageId]: [...(history[pageId] ?? []), previous] }))
        setAnnotationRedo(history => ({ ...history, [pageId]: [] }))
      }
      const next = { ...current, [pageId]: strokes }
      queueAnnotationAutosave(next)
      return next
    })
  }
  const undoAnnotation = () => current && setAnnotationUndo(history => {
    const entries = history[current.id] ?? []
    if (!entries.length) return history
    const previous = entries.at(-1)!
    setAnnotationDraft(draft => { setAnnotationRedo(redo => ({ ...redo, [current.id]: [...(redo[current.id] ?? []), draft[current.id] ?? []] })); const next = { ...draft, [current.id]: previous }; queueAnnotationAutosave(next); return next })
    return { ...history, [current.id]: entries.slice(0, -1) }
  })
  const redoAnnotation = () => current && setAnnotationRedo(history => {
    const entries = history[current.id] ?? []
    if (!entries.length) return history
    const next = entries.at(-1)!
    setAnnotationDraft(draft => { setAnnotationUndo(undo => ({ ...undo, [current.id]: [...(undo[current.id] ?? []), draft[current.id] ?? []] })); const updated = { ...draft, [current.id]: next }; queueAnnotationAutosave(updated); return updated })
    return { ...history, [current.id]: entries.slice(0, -1) }
  })
  const saveAnnotations = async (copy: boolean) => {
    setAnnotationBusy(true); setAnnotationError('')
    window.clearTimeout(annotationAutosaveTimer.current)
    try {
      await annotationAutosavePending.current
      const prepared = documentWithAnnotations(annotationDraftRef.current)
      if (copy) await onSaveCopy(await annotationCopy(prepared))
      else {
        const previousPdfPath = document.pdfPath
        const updated = await finalizeAnnotations(prepared)
        try { await onChange(updated) } catch (error) { await documentStorageService.removeFile(updated.pdfPath); throw error }
        if (previousPdfPath && previousPdfPath !== updated.pdfPath) await documentStorageService.removeFile(previousPdfPath)
      }
      setAnnotationMode('pan'); setAnnotationOpen(false); setAnnotationSaveOpen(false); setAnnotationNotice(copy ? 'Annotated copy saved' : 'Annotations saved')
    } catch (error) { setAnnotationError(error instanceof Error ? error.message : 'Annotations could not be saved safely.') }
    finally { setAnnotationBusy(false) }
  }
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }, [])
  const [externalState, setExternalState] = useState<'idle' | 'working'>('idle')
  const [thumbnailsVisible, setThumbnailsVisible] = useState(true)
  const [viewControlsOpen, setViewControlsOpen] = useState(false)
  const [textSelection, setTextSelection] = useState({ start: 0, end: 0 })
  const [copyStatus, setCopyStatus] = useState('')
  const current = document.pages[page]
  const detectedCodes = useMemo(() => document.pages.flatMap((item) => item.barcodes ?? []), [document.pages])
  const matches = useMemo(() => pageMatches(document, withinQuery), [document, withinQuery])
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const activeMatch = matches[activeMatchIndex]
  useEffect(() => {
    if (readingMode !== 'single') return
    setThumbnailsVisible(true)
    const timer = window.setTimeout(() => setThumbnailsVisible(false), 2400)
    return () => window.clearTimeout(timer)
  }, [page, readingMode])
  const navigatePage = (direction: -1 | 1) => setPage(currentPage => Math.max(0, Math.min(document.pages.length - 1, currentPage + direction)))
  useEffect(() => {
    void screenSecurityService.setEnabled(Boolean(document.isPrivate))
    return () => {
      void screenSecurityService.setEnabled(false)
    }
  }, [document.isPrivate])
  useEffect(
    () => () => {
      void privateStorageService.clearSession(document.privateSessionId)
    },
    [document.privateSessionId]
  )
  useEffect(() => {
    setTitle(document.title)
  }, [document.title])
  useEffect(() => {
    if (!actionsOpen) return
    const previousOverflow = globalThis.document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeActions()
    }
    globalThis.document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      globalThis.document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [actionsOpen])
  useEffect(() => {
    setActiveMatchIndex(0)
    if (matches[0]) setPage(matches[0].pageIndex)
  }, [matches])
  const moveMatch = (direction: -1 | 1) => {
    if (!matches.length) return
    const next = (activeMatchIndex + direction + matches.length) % matches.length
    setActiveMatchIndex(next)
    setPage(matches[next].pageIndex)
  }
  const saveTitle = () => {
    const trimmed = title.trim()
    if (trimmed)
      onChange({
        ...document,
        title: trimmed,
        titleSource: 'manual',
        updatedAt: new Date().toISOString()
      })
    setEditing(false)
  }
  const closeActions = () => {
    setActionsOpen(false)
    setActionView('main')
    setCustomFolder('')
    setPdfPassword('')
    setPdfPasswordConfirm('')
    setActionError('')
  }
  useEffect(() => {
    const back = (raw: Event) => {
      if (deleteConfirm) setDeleteConfirm(false)
      else if (actionsOpen) closeActions()
      else if (viewControlsOpen) setViewControlsOpen(false)
      else if (annotationSaveOpen) setAnnotationSaveOpen(false)
      else if (annotationOpen) void saveAnnotations(false)
      else if (searchOpen) { setWithinQuery(''); setSearchOpen(false) }
      else if (editingPage) setEditingPage(false)
      else if (editing) { setEditing(false); setTitle(document.title) }
      else return
      raw.preventDefault()
    }
    window.addEventListener('local:back', back)
    return () => window.removeEventListener('local:back', back)
  }, [deleteConfirm, actionsOpen, viewControlsOpen, annotationSaveOpen, annotationOpen, searchOpen, editingPage, editing, document.title])
  const openFolderPicker = async () => {
    setActionView('folder')
    setFoldersLoading(true)
    setActionError('')
    try {
      const latestDocuments = await documentsRepository.list()
      setFolderOptions(await folderService.list(latestDocuments))
    } catch {
      setActionError('Could not refresh folders. Please try again.')
    } finally {
      setFoldersLoading(false)
    }
  }
  const updateMetadata = async (changes: Partial<Pick<VaultDocument, 'folder' | 'isPrivate'>>) => {
    setActionBusy(true)
    setActionError('')
    try {
      await onChange({
        ...document,
        ...changes,
        updatedAt: new Date().toISOString()
      })
      closeActions()
    } catch {
      setActionError('Could not update this document. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }
  const togglePrivacy = async () => {
    setActionBusy(true)
    setActionError('')
    try {
      await appLockService.authenticate()
      await onChange({
        ...document,
        isPrivate: !document.isPrivate,
        updatedAt: new Date().toISOString()
      })
      if (document.isPrivate) closeActions()
      else {
        setActionBusy(false)
        setActionView('private')
      }
    } catch {
      setActionError('Authentication was cancelled or unsuccessful.')
    } finally {
      setActionBusy(false)
    }
  }
  const applyPdfPassword = async () => {
    if (pdfPassword.length < 8) {
      setActionError('Use at least 8 characters.')
      return
    }
    if (pdfPassword !== pdfPasswordConfirm) {
      setActionError('The passwords do not match.')
      return
    }
    setActionBusy(true)
    setActionError('')
    try {
      const updated = await passwordProtectPdf(document, pdfPassword)
      await onChange(updated)
      closeActions()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not protect this PDF.')
    } finally {
      setActionBusy(false)
    }
  }
  const clearPdfPassword = async () => {
    setActionBusy(true)
    setActionError('')
    try {
      const updated = await removePdfPassword(document)
      await onChange(updated)
      closeActions()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not remove PDF password protection.')
    } finally {
      setActionBusy(false)
    }
  }
  const moveToNewFolder = async () => {
    const name = customFolder.trim()
    if (!name) return
    setActionBusy(true)
    setActionError('')
    try {
      const latestDocuments = await documentsRepository.list()
      const folder = await folderService.create(name, latestDocuments)
      await onChange({
        ...document,
        folder,
        updatedAt: new Date().toISOString()
      })
      closeActions()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create this folder.')
    } finally {
      setActionBusy(false)
    }
  }
  const saveTags = async (tags: string[]) => {
    setActionBusy(true)
    setActionError('')
    try {
      await onChange({
        ...document,
        tags,
        updatedAt: new Date().toISOString()
      })
      closeActions()
    } catch {
      setActionError('Could not save these tags. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }
  const copyPageText = async (selectionOnly: boolean) => {
    const text = current?.ocrText.trim() ?? ''
    const selected = text.slice(textSelection.start, textSelection.end)
    const value = selectionOnly ? selected : text
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(selectionOnly ? 'Selected text copied' : 'All page text copied')
      window.setTimeout(() => setCopyStatus(''), 1400)
    } catch {
      setCopyStatus('Could not copy text. Select it and use the system Copy action.')
    }
  }
  const highlights = activeMatch?.pageIndex === page ? activeMatch.wordIndexes.flatMap((index) => current.ocrWords?.[index]?.boundingBox ?? []) : []
  const downloadPdf = async () => {
    setExportState('working')
    setExportError('')
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
    setExportState('opening')
    setExportError('')
    try {
      await openDownloadedPdf()
      setExportState('success')
    } catch (error) {
      console.error(error)
      setExportError(error instanceof Error ? error.message : 'No app could open this PDF.')
      setExportState('success')
    }
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
  const openExternal = async () => {
    setExternalState('working'); setExportError('')
    try { const ready = await openPdfExternally(document); if (ready !== document) await onChange(ready) }
    catch (error) { setExportError(error instanceof Error ? error.message : 'No app could open this PDF.') }
    finally { setExternalState('idle') }
  }
  const saveEditedPage = async (updatedPage: DocumentPage) => {
    const updatedDocument: VaultDocument = {
      ...document,
      pages: document.pages.map((item) => (item.id === updatedPage.id ? updatedPage : item)),
      status: 'ocr_pending',
      processingStage: 'ocr',
      pdfPath: undefined,
      privatePdfPath: undefined,
      pdfGeneratedAt: undefined,
      pdfPasswordProtected: undefined,
      updatedAt: new Date().toISOString()
    }
    await onChange(updatedDocument)
    setEditingPage(false)
    void retryProcessing(updatedDocument.id, onChange)
  }
  if (editingPage && current)
    return (
      <ScanPageEditor
        page={current}
        pageNumber={page + 1}
        initialMode="crop"
        onCancel={() => setEditingPage(false)}
        onSave={(updated) => {
          void saveEditedPage(updated)
        }}
      />
    )
  return (
    <div className={`full-screen viewer-screen viewer-theme-${viewerTheme}${chromeVisible ? '' : ' chrome-hidden'}${trimMargins ? ' trim-margins' : ''}`}>
      <header className="top-bar">
        <button onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </button>
        <div>
          {editing ? (
            <input className="title-edit" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => event.key === 'Enter' && saveTitle()} autoFocus />
          ) : (
            <>
              <strong>
                {document.isPrivate && <Lock size={13} />} {document.title}
              </strong>
              <span>
                {document.folder} · {document.pages.length} pages
              </span>
            </>
          )}
        </div>
        <div className="viewer-header-actions">
          <button className={annotationOpen ? 'active annotation-active' : ''} onClick={() => { if (annotationOpen) void saveAnnotations(false); else { setReadingMode('single'); setAnnotationOpen(true); setAnnotationMode('pen'); setChromeVisible(true); setThumbnailsVisible(false); setAnnotationNotice('') } }} aria-label={annotationOpen ? 'Finish annotating' : 'Annotate document'}>{annotationOpen ? <Check /> : <Pencil />}</button>
          <button className={searchOpen ? 'active' : ''} onClick={() => setSearchOpen((open) => !open)} aria-label="Search this document"><Search /></button>
          <button className={viewControlsOpen ? 'active' : ''} onClick={() => setViewControlsOpen(true)} aria-label="Reading view" aria-haspopup="dialog"><BookOpen /></button>
          <button onClick={() => setActionsOpen(true)} aria-label="More actions" aria-haspopup="dialog"><MoreHorizontal /></button>
        </div>
      </header>
      <div className={`processing-banner ${document.status === 'error' ? 'has-error' : ''} ${document.status === 'ocr_pending' || document.status === 'ocr_processing' ? 'working' : ''}`}>
        <Clock3 size={17} />
        <span>{statusLabel(document)}</span>
        {document.status === 'indexed' && <Check size={17} />}
        {(document.status === 'ocr_pending' || document.status === 'ocr_processing') && (
          <button
            disabled={jobAction === 'working'}
            onClick={() => {
              setJobAction('working')
              void cancelProcessing(document.id, (updated) => {
                onChange(updated)
                setJobAction('idle')
              })
            }}
          >
            <PauseCircle /> Pause
          </button>
        )}
        {(document.status === 'error' || document.status === 'saved') && (document.processingStage === 'pdf' || document.pages.some((item) => item.ocrState !== 'complete')) && (
          <button
            disabled={jobAction === 'working'}
            onClick={() => {
              setJobAction('working')
              void retryProcessing(document.id, (updated) => {
                onChange(updated)
                if (updated.status === 'indexed' || updated.status === 'error') setJobAction('idle')
              })
            }}
          >
            <RefreshCw /> {document.processingStage === 'pdf' ? 'Retry PDF' : 'Recognise text again'}
          </button>
        )}
      </div>
      {searchOpen && (
        <div className="viewer-search">
          <Search />
          <input value={withinQuery} onChange={(event) => setWithinQuery(event.target.value)} placeholder="Search this document" aria-label="Search this document" autoFocus />
          <span>{withinQuery ? (matches.length ? `${activeMatchIndex + 1}/${matches.length}` : '0') : ''}</span>
          <button onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="Previous match">
            <ChevronUp />
          </button>
          <button onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="Next match">
            <ChevronDown />
          </button>
          <button
            onClick={() => {
              setWithinQuery('')
              setSearchOpen(false)
            }}
            aria-label="Close search"
          >
            <X />
          </button>
        </div>
      )}
      {document.tags.length > 0 && (
        <div className="viewer-tags" aria-label="Document tags">
          {document.tags.map((tag) => (
            <span key={tag}>
              <Tag />
              {tag}
            </span>
          ))}
        </div>
      )}
      {detectedCodes.length > 0 && (
        <div className="code-index-banner">
          <ScanLine />
          <strong>
            {detectedCodes.length} {detectedCodes.length === 1 ? 'code' : 'codes'} indexed
          </strong>
          <span>{detectedCodes[0].displayValue || detectedCodes[0].rawValue}</span>
        </div>
      )}
      <section className={`document-canvas mode-${readingMode}`} onClick={(event) => { if (!(event.target as HTMLElement).closest('.zoom-controls,.show-pages-button,.viewer-scrubber')) { chromeVisible ? setChromeVisible(false) : revealChrome() } }}>
        {readingMode === 'single' && current ? <ZoomablePage key={current.id} src={current.imageUrl} alt={`Page ${page + 1}`} rotation={current.rotation} highlights={highlights} annotations={annotationDraft[current.id] ?? []} annotationsVisible={annotationsVisible} annotationMode={annotationMode} annotationColor={annotationColor} annotationWidth={annotationWidth} initialView={readingState.current.single} trimMargins={trimMargins} onAnnotationsChange={strokes => changeAnnotations(current.id, strokes)} onViewChange={saveSingleView} onNavigate={navigatePage} /> : readingMode === 'continuous' || readingMode === 'facing' ? <ContinuousPages pages={document.pages.map(item => ({ ...item, annotations: { version: 1, strokes: annotationDraft[item.id] ?? [] } }))} currentPage={page} initialView={readingState.current.continuous} trimMargins={trimMargins} facing={readingMode === 'facing'} annotationsVisible={annotationsVisible} onViewChange={saveContinuousView} onPage={setPage} /> : <div className="ocr-reading-view"><header><div><strong>Text view</strong><span>Offline text recognition may contain errors</span></div><button onClick={toggleReadAloud}>{speaking ? <VolumeX /> : <Volume2 />} {speaking ? 'Stop' : 'Read from here'}</button></header>{document.pages.map((item, index) => <article key={item.id} className={index === page ? 'current' : ''} onClick={() => setPage(index)}><span>Page {index + 1}</span>{item.ocrText.trim() ? <p>{item.ocrText}</p> : <p className="empty">No text was detected on this page.</p>}</article>)}</div>}
        {readingMode === 'single' && !thumbnailsVisible && <button className="show-pages-button" onClick={() => setThumbnailsVisible(true)} aria-label="Show page thumbnails"><Grid2X2 /><span>{page + 1} / {document.pages.length}</span></button>}
        {activeMatch?.pageIndex === page && (
          <div className="viewer-match">
            <b>Page {page + 1}</b>
            <span>
              <HighlightedText text={activeMatch.snippet} query={withinQuery} />
            </span>
          </div>
        )}
      </section>
      {annotationOpen && current && <aside className="annotation-toolbar" aria-label="Annotation tools">
        <div className="annotation-mode-label"><Pencil /><span><strong>{annotationMode === 'pan' ? 'Pan and zoom' : 'Drawing'}</strong><small>{annotationNotice || (annotationMode === 'pan' ? 'Choose a tool to continue' : 'Changes save automatically')}</small></span></div>
        <div role="group" aria-label="Drawing tool"><button className={annotationMode === 'pan' ? 'active' : ''} onClick={() => setAnnotationMode('pan')} aria-label="Pan and zoom"><MousePointer2 /></button><button className={annotationMode === 'pen' ? 'active' : ''} onClick={() => setAnnotationMode('pen')} aria-label="Pen"><Pencil /></button><button className={annotationMode === 'highlighter' ? 'active' : ''} onClick={() => setAnnotationMode('highlighter')} aria-label="Highlighter"><Highlighter /></button><button className={annotationMode === 'eraser' ? 'active' : ''} onClick={() => setAnnotationMode('eraser')} aria-label="Stroke eraser"><Eraser /></button></div>
        <label className="annotation-color"><span>Colour</span><input type="color" value={annotationColor} onChange={event => setAnnotationColor(event.target.value)} /></label>
        <label className="annotation-width"><span>Width</span><input type="range" min="0.002" max="0.035" step="0.002" value={annotationWidth} onChange={event => setAnnotationWidth(Number(event.target.value))} /></label>
        <div role="group" aria-label="Annotation history"><button onClick={undoAnnotation} disabled={!(annotationUndo[current.id]?.length)} aria-label="Undo"><Undo2 /></button><button onClick={redoAnnotation} disabled={!(annotationRedo[current.id]?.length)} aria-label="Redo"><Redo2 /></button><button onClick={() => setAnnotationsVisible(value => !value)} aria-label={annotationsVisible ? 'Hide annotations' : 'Show annotations'}>{annotationsVisible ? <Eye /> : <EyeOff />}</button><button onClick={() => setAnnotationSaveOpen(true)} aria-label="More annotation options"><MoreHorizontal /></button><button className="done" disabled={annotationBusy} onClick={() => void saveAnnotations(false)}><Check /><span>Done</span></button></div>
      </aside>}
      {!annotationOpen && <aside className="viewer-scrubber" aria-label="Page navigation">
        <button className={bookmarks.includes(page) ? 'active' : ''} onClick={toggleBookmark} aria-label={bookmarks.includes(page) ? 'Remove bookmark' : 'Bookmark this page'}><Bookmark /></button>
        <button className="viewer-page-button" onClick={() => setThumbnailsVisible(value => !value)} aria-expanded={thumbnailsVisible} aria-label="Show pages"><Grid2X2 /><span>Page {page + 1} of {document.pages.length}</span></button>
      </aside>}
      <section className={`thumbnail-strip${thumbnailsVisible && readingMode === 'single' ? ' visible' : ''}`} aria-label="Pages" aria-hidden={!thumbnailsVisible || readingMode !== 'single'}>
        {document.pages.map((item, index) => (
          <button key={item.id} className={index === page ? 'active' : ''} onClick={() => setPage(index)}>
            <img src={item.thumbnailUrl || item.imageUrl} alt={`Page ${index + 1}`} />
            <span>{index + 1}</span>
          </button>
        ))}
      </section>
      {viewControlsOpen && (
        <div className="action-sheet-layer" role="presentation" onClick={() => setViewControlsOpen(false)}>
          <section className="viewer-display-sheet" role="dialog" aria-modal="true" aria-labelledby="reading-view-title" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <header><div><strong id="reading-view-title">Reading view</strong><span>Choose how pages move on screen</span></div><button onClick={() => setViewControlsOpen(false)} aria-label="Close"><X /></button></header>
            <div className="reading-view-options">
              <button className={readingMode === 'single' ? 'selected' : ''} onClick={() => { setReadingMode('single'); setViewControlsOpen(false) }} aria-pressed={readingMode === 'single'}>
                <BookOpen /><span><strong>Single page</strong><small>Swipe left or right to change pages. Pinch or use the zoom controls.</small></span>{readingMode === 'single' && <Check />}
              </button>
              <button className={readingMode === 'continuous' ? 'selected' : ''} onClick={() => { setReadingMode('continuous'); setViewControlsOpen(false) }} aria-pressed={readingMode === 'continuous'}>
                <Rows3 /><span><strong>Continuous scroll</strong><small>Read every page from top to bottom in one vertical stream.</small></span>{readingMode === 'continuous' && <Check />}
              </button>
              <button className={readingMode === 'facing' ? 'selected' : ''} onClick={() => { setReadingMode('facing'); setViewControlsOpen(false) }} aria-pressed={readingMode === 'facing'}>
                <BookOpen /><span><strong>Two-page spread</strong><small>Place pages side by side for landscape and larger screens.</small></span>{readingMode === 'facing' && <Check />}
              </button>
              <button className={readingMode === 'text' ? 'selected' : ''} onClick={() => { setReadingMode('text'); setViewControlsOpen(false) }} aria-pressed={readingMode === 'text'}>
                <FileText /><span><strong>Text view</strong><small>Read, select, copy or hear the text from this document.</small></span>{readingMode === 'text' && <Check />}
              </button>
            </div>
            <div className="viewer-preference-group"><strong>Page appearance</strong><div className="viewer-theme-options"><button className={viewerTheme === 'original' ? 'selected' : ''} onClick={() => setViewerTheme('original')}><Sun /> Original</button><button className={viewerTheme === 'sepia' ? 'selected' : ''} onClick={() => setViewerTheme('sepia')}>Sepia</button><button className={viewerTheme === 'night' ? 'selected' : ''} onClick={() => setViewerTheme('night')}><Moon /> Night</button></div></div>
            <div className="viewer-preference-toggles"><label><input type="checkbox" checked={trimMargins} onChange={(event) => setTrimMargins(event.target.checked)} /><span><strong>Reduce page margins</strong><small>Enlarge the readable page area without changing the PDF</small></span></label><label><input type="checkbox" checked={keepAwake} onChange={(event) => setKeepAwake(event.target.checked)} /><span><strong>Keep screen awake</strong><small>Prevent sleep while this document is open</small></span></label></div>
            <div className="viewer-bookmarks"><header><strong>Bookmarks</strong><button onClick={toggleBookmark}><Bookmark /> {bookmarks.includes(page) ? 'Remove current' : 'Add current'}</button></header>{bookmarks.length ? <div>{bookmarks.map(value => <button key={value} onClick={() => { goToPage(value); setViewControlsOpen(false) }}>Page {value + 1}</button>)}</div> : <small>No bookmarks in this document yet.</small>}</div>
            <p>LOCAL remembers this document's page, reading mode and zoom. Double-tap any area for a quick focused zoom.</p>
          </section>
        </div>
      )}
      {annotationSaveOpen && <div className="action-sheet-layer" role="presentation" onClick={() => !annotationBusy && setAnnotationSaveOpen(false)}><section className="annotation-save-sheet" role="dialog" aria-modal="true" aria-label="More annotation options" onClick={event => event.stopPropagation()}><header><div><strong>More options</strong><span>Your current document is saved automatically when you tap Done.</span></div><button disabled={annotationBusy} onClick={() => setAnnotationSaveOpen(false)} aria-label="Close"><X /></button></header>{annotationError && <p className="form-error">{annotationError}</p>}<button disabled={annotationBusy} onClick={() => void saveAnnotations(true)}><Copy /><span><strong>Save annotated copy</strong><small>Keep the original document unchanged</small></span></button>{annotationBusy && <p><span className="button-spinner" /> Preparing copy…</p>}</section></div>}
      {deleteConfirm ? <ConfirmSheet title={`Move “${document.title}” to Recently Deleted?`} message="The document can be restored for 30 days before it is permanently removed." confirmLabel="Move to Recently Deleted" onConfirm={() => void onDelete()} onCancel={() => setDeleteConfirm(false)} /> : null}
      {actionsOpen && (
        <div className="action-sheet-layer" role="presentation" onClick={closeActions}>
          <section className="document-action-sheet" role="dialog" aria-modal="true" aria-label={actionView === 'folder' ? 'Move document' : 'Document actions'} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            {actionView === 'main' ? (
              <>
                <header>
                  <div>
                    <strong>Document options</strong>
                    <span>
                      {document.folder}
                      {document.isPrivate ? ' · Private' : ''}
                    </span>
                  </div>
                  <button onClick={closeActions} aria-label="Close">
                    <X />
                  </button>
                </header>
                <div className="sheet-actions">
                  <div className="file-action-grid" aria-label="PDF file actions">
                    <button onClick={() => void (exportState === 'success' ? openPdf() : downloadPdf())} disabled={exportState === 'working' || exportState === 'opening'}>
                      {exportState === 'working' || exportState === 'opening' ? <span className="button-spinner" /> : exportState === 'success' ? <ExternalLink /> : <Download />}
                      <strong>{exportState === 'working' ? 'Saving…' : exportState === 'opening' ? 'Opening…' : exportState === 'success' ? 'Open copy' : 'Save copy'}</strong>
                    </button>
                    <button onClick={() => void sharePdf()} disabled={shareState === 'working'}>{shareState === 'working' ? <span className="button-spinner" /> : <Share2 />}<strong>Share</strong></button>
                    <button onClick={() => void openExternal()} disabled={externalState === 'working'}>{externalState === 'working' ? <span className="button-spinner" /> : <AppWindow />}<strong>Open with</strong></button>
                  </div>
                  {exportState === 'success' && <p className="sheet-operation-status"><Check /> Copy saved to Downloads · LOCAL</p>}
                  {exportError && <p className="sheet-error" role="alert">{exportError}</p>}
                  {shareState === 'error' && <p className="sheet-error" role="alert">Could not open sharing. Please try again.</p>}
                  <button onClick={() => { setTextSelection({ start: 0, end: 0 }); setCopyStatus(''); setActionView('text') }}>
                    <FileText />
                    <span>
                      <strong>Extract text from this page</strong>
                      <small>Select a passage or copy all text from page {page + 1}</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button
                    onClick={() => {
                      closeActions()
                      setEditingPage(true)
                    }}
                  >
                    <Crop />
                    <span>
                      <strong>Crop this page</strong>
                      <small>Adjust the borders of page {page + 1}</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button
                    onClick={() => {
                      closeActions()
                      setEditing(true)
                    }}
                  >
                    <Pencil />
                    <span>
                      <strong>Rename</strong>
                      <small>Change the document name</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button onClick={() => void openFolderPicker()}>
                    <FolderOpen />
                    <span>
                      <strong>Move to folder</strong>
                      <small>Currently in {document.folder}</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button onClick={() => setActionView('tags')}>
                    <Tag />
                    <span>
                      <strong>Manage tags</strong>
                      <small>{document.tags.length ? document.tags.join(', ') : 'Add searchable labels'}</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button disabled={actionBusy} onClick={() => void togglePrivacy()}>
                    {document.isPrivate ? <Unlock /> : <Lock />}
                    <span>
                      <strong>{document.isPrivate ? 'Remove private lock' : 'Make private'}</strong>
                      <small>{document.isPrivate ? 'Stop requiring document-level authentication' : 'Lock access inside LOCAL and hide previews'}</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button onClick={() => setActionView('password')}>
                    <ShieldCheck />
                    <span>
                      <strong>{document.pdfPasswordProtected ? 'Change PDF password' : 'Add PDF password'}</strong>
                      <small>{document.pdfPasswordProtected ? 'AES-256 protection is enabled' : 'Protect Downloads and shared copies'}</small>
                    </span>
                    <ChevronRight />
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      closeActions()
                      setDeleteConfirm(true)
                    }}
                  >
                    <Trash2 />
                    <span>
                      <strong>Delete document</strong>
                      <small>Recoverable for 30 days</small>
                    </span>
                    <ChevronRight />
                  </button>
                </div>
              </>
            ) : actionView === 'folder' ? (
              <>
                <header>
                  <button onClick={() => setActionView('main')} aria-label="Back">
                    <ArrowLeft />
                  </button>
                  <div>
                    <strong>Move to folder</strong>
                    <span>Choose where this document belongs</span>
                  </div>
                  <button onClick={closeActions} aria-label="Close">
                    <X />
                  </button>
                </header>
                <div className="folder-options">
                  {foldersLoading ? (
                    <span className="button-spinner" role="status" aria-label="Refreshing folders" />
                  ) : (
                    folderOptions.map((folder) => (
                      <button key={folder} className={document.folder === folder ? 'selected' : ''} disabled={actionBusy} onClick={() => void updateMetadata({ folder })}>
                        <Folder /> <span>{folder}</span>
                        {document.folder === folder && <Check />}
                      </button>
                    ))
                  )}
                </div>
                <form
                  className="custom-folder"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void moveToNewFolder()
                  }}
                >
                  <label htmlFor="custom-folder-name">New folder</label>
                  <div>
                    <input id="custom-folder-name" value={customFolder} onChange={(event) => setCustomFolder(event.target.value)} placeholder="Enter folder name" maxLength={48} />
                    <button disabled={actionBusy || !customFolder.trim()}>
                      <Check /> Create & move
                    </button>
                  </div>
                </form>
              </>
            ) : actionView === 'tags' ? (
              <TagEditorSheet initialTags={document.tags} busy={actionBusy} error={actionError} onClose={closeActions} onSave={(tags) => void saveTags(tags)} />
            ) : actionView === 'text' ? (
              <>
                <header>
                  <button onClick={() => setActionView('main')} aria-label="Back"><ArrowLeft /></button>
                  <div><strong>Text from page {page + 1}</strong><span>Select exactly what you need</span></div>
                  <button onClick={closeActions} aria-label="Close"><X /></button>
                </header>
                <div className="page-text-extractor">
                  {current?.ocrText.trim() ? (
                    <>
                      <p>Press and drag over the text below, then copy the selection—or copy the entire page.</p>
                      <textarea
                        readOnly
                        value={current.ocrText.trim()}
                        onSelect={(event) => setTextSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                        aria-label={`Text from page ${page + 1}`}
                      />
                      <div>
                        <button disabled={textSelection.end <= textSelection.start} onClick={() => void copyPageText(true)}><Copy /> Copy selection</button>
                        <button onClick={() => void copyPageText(false)}><FileText /> Copy all</button>
                      </div>
                      {copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}
                    </>
                  ) : (
                    <div className="no-page-text"><FileText /><strong>No text was detected on this page</strong><span>Choose “Recognise text again” if the page contains visible text.</span></div>
                  )}
                </div>
              </>
            ) : actionView === 'private' ? (
              <>
                <header>
                  <div>
                    <strong>Private lock enabled</strong>
                    <span>This document now requires device authentication in LOCAL</span>
                  </div>
                  <button onClick={closeActions} aria-label="Close">
                    <X />
                  </button>
                </header>
                <div className="privacy-level-card">
                  <Lock />
                  <strong>Protected inside LOCAL</strong>
                  <p>The title and preview are hidden. Add a PDF password as well if downloaded and shared copies must remain protected.</p>
                  <button onClick={() => setActionView('password')}>
                    <ShieldCheck /> Add PDF password
                  </button>
                  <button className="quiet" onClick={closeActions}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <header>
                  <button onClick={() => setActionView('main')} aria-label="Back">
                    <ArrowLeft />
                  </button>
                  <div>
                    <strong>{document.pdfPasswordProtected ? 'Change PDF password' : 'Add PDF password'}</strong>
                    <span>Protect the PDF outside LOCAL</span>
                  </div>
                  <button onClick={closeActions} aria-label="Close">
                    <X />
                  </button>
                </header>
                <form
                  className="password-protection-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void applyPdfPassword()
                  }}
                >
                  <div className="portable-protection-note">
                    <ShieldCheck />
                    <div>
                      <strong>AES-256 PDF protection</strong>
                      <span>Foxit and other compatible readers will request this password.</span>
                    </div>
                  </div>
                  <label>
                    Password
                    <input type="password" value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} minLength={8} maxLength={64} autoComplete="new-password" placeholder="At least 8 characters" />
                  </label>
                  <label>
                    Confirm password
                    <input type="password" value={pdfPasswordConfirm} onChange={(event) => setPdfPasswordConfirm(event.target.value)} minLength={8} maxLength={64} autoComplete="new-password" placeholder="Enter it again" />
                  </label>
                  <p>LOCAL does not save this password and cannot recover it. Keep it somewhere safe.</p>
                  <button className="protect-pdf-button" disabled={actionBusy || pdfPassword.length < 8 || pdfPasswordConfirm.length < 8}>
                    {actionBusy ? <span className="button-spinner" /> : <Lock />} {document.pdfPasswordProtected ? 'Replace password' : 'Protect PDF'}
                  </button>
                  {document.pdfPasswordProtected && (
                    <button type="button" className="remove-pdf-password" disabled={actionBusy} onClick={() => void clearPdfPassword()}>
                      <Unlock /> Remove PDF password
                    </button>
                  )}
                </form>
              </>
            )}
            {actionError && (
              <p className="sheet-error" role="alert">
                {actionError}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Folders({ documents, onOpen, onChange }: { documents: VaultDocument[]; onOpen: (id: string) => void; onChange: () => Promise<void> }) {
  const [folders, setFolders] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [removeConfirm, setRemoveConfirm] = useState(false)
  useEffect(() => {
    void folderService
      .list(documents)
      .then(setFolders)
      .catch(() => setError('Could not load folders.'))
  }, [documents])
  const visible = selected ? documents.filter((document) => document.folder === selected) : []
  const create = async () => {
    try {
      const created = await folderService.create(name, documents)
      setFolders(await folderService.list(documents))
      setName('')
      setCreating(false)
      setSelected(created)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the folder.')
    }
  }
  const rename = async () => {
    if (!selected) return
    const next = prompt('Rename folder', selected)
    if (next == null) return
    try {
      const renamed = await folderService.rename(selected, next, documents)
      await onChange()
      setFolders(await folderService.list(documents.map((document) => (document.folder === selected ? { ...document, folder: renamed } : document))))
      setSelected(renamed)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename the folder.')
    }
  }
  const remove = async () => {
    if (!selected) return
    setRemoveConfirm(false)
    try {
      await folderService.remove(selected, documents)
      setSelected(null)
      await onChange()
      setFolders(await folderService.list(documents.map((document) => (document.folder === selected ? { ...document, folder: 'Unfiled' } : document))))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the folder.')
    }
  }
  return (
    <>
      <PageHeader icon={<FolderOpen />} title="Folders" subtitle="Keep related papers together" />
      {selected ? (
        <section className="section-block">
          <button className="inline-back" onClick={() => setSelected(null)}>
            <ArrowLeft /> All folders
          </button>
          <div className="folder-title-row">
            <div>
              <strong>{selected}</strong>
              <small>{visible.length} documents</small>
            </div>
            {selected !== 'Unfiled' && (
              <div>
                <button onClick={() => void rename()}>
                  <Pencil /> Rename
                </button>
                <button className="danger" onClick={() => setRemoveConfirm(true)}>
                  <Trash2 /> Delete
                </button>
              </div>
            )}
          </div>
          {visible.length ? (
            <div className="document-list">
              {visible.map((document) => (
                <DocumentRow key={document.id} document={document} onClick={() => onOpen(document.id)} />
              ))}
            </div>
          ) : (
            <div className="folder-empty">
              <Folder />
              <p>This folder is empty. Move documents here from their options menu.</p>
            </div>
          )}
        </section>
      ) : (
        <>
          <button className="create-folder-button" onClick={() => setCreating(true)}>
            <FolderOpen /> Create folder
          </button>
          {creating && (
            <form
              className="folder-create-form"
              onSubmit={(event) => {
                event.preventDefault()
                void create()
              }}
            >
              <label htmlFor="folder-name">Folder name</label>
              <div>
                <input id="folder-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} autoFocus />
                <button disabled={!name.trim()}>
                  <Check /> Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false)
                    setName('')
                    setError('')
                  }}
                >
                  <X />
                </button>
              </div>
            </form>
          )}
          <div className="folder-grid">
            {folders.map((folder) => {
              const count = documents.filter((document) => document.folder === folder).length
              return (
                <button key={folder} onClick={() => setSelected(folder)}>
                  <Folder />
                  <strong>{folder}</strong>
                  <span>
                    {count} document{count === 1 ? '' : 's'}
                  </span>
                  <ChevronRight />
                </button>
              )
            })}
          </div>
        </>
      )}
      {error && (
        <p className="folder-error" role="alert">
          {error}
        </p>
      )}
      {removeConfirm && selected ? <ConfirmSheet title={`Delete “${selected}”?`} message={`${visible.length} document${visible.length === 1 ? '' : 's'} will be moved safely to Unfiled. No documents will be deleted.`} confirmLabel="Delete folder" onConfirm={() => void remove()} onCancel={() => setRemoveConfirm(false)} /> : null}
    </>
  )
}

function TrashScreen({ onBack, onChanged }: { onBack: () => void; onChanged: () => Promise<void> }) {
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<VaultDocument | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDocuments(await documentsRepository.listDeleted())
      setError('')
    } catch {
      setError('Recently Deleted could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const restore = async (document: VaultDocument) => {
    setBusyId(document.id)
    try {
      const restored = {
        ...document,
        deletedAt: undefined,
        updatedAt: new Date().toISOString()
      }
      await documentsRepository.save(restored)
      if (restored.status !== 'indexed') void retryProcessing(restored.id, () => undefined)
      await onChanged()
      await load()
    } catch {
      setError('This document could not be restored.')
    } finally {
      setBusyId('')
    }
  }
  const removePermanently = async () => {
    if (!confirmDelete) return
    const id = confirmDelete.id
    setConfirmDelete(null)
    setBusyId(id)
    try {
      await documentsRepository.remove(id)
      await load()
    } catch {
      setError('This document could not be permanently deleted.')
    } finally {
      setBusyId('')
    }
  }
  return (
    <div className="trash-screen">
      <header className="top-bar">
        <button onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </button>
        <div>
          <strong>Recently Deleted</strong>
          <span>Documents are removed permanently after 30 days</span>
        </div>
        <span />
      </header>
      {loading ? (
        <EmptyLoading />
      ) : documents.length ? (
        <div className="trash-list">
          {documents.map((document) => {
            const age = Date.now() - new Date(document.deletedAt!).getTime()
            const days = Math.max(1, 30 - Math.floor(age / 86400000))
            return (
              <article key={document.id}>
                <div className="trash-thumb">{document.isPrivate ? <Lock /> : document.pages[0] ? <img src={document.pages[0].thumbnailUrl || document.pages[0].imageUrl} alt="" /> : <FileText />}</div>
                <div>
                  <strong>{document.isPrivate ? 'Private document' : document.title}</strong>
                  <small>
                    {days} day{days === 1 ? '' : 's'} remaining · {document.pages.length} pages
                  </small>
                </div>
                <button disabled={busyId === document.id} onClick={() => void restore(document)}>
                  <RotateCcw /> Restore
                </button>
                <button className="danger" disabled={busyId === document.id} onClick={() => setConfirmDelete(document)}>
                  <Trash2 /> Delete now
                </button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Trash2 />
          </div>
          <h3>Recently Deleted is empty</h3>
          <p>Deleted documents will stay here for 30 days so you can recover them.</p>
        </div>
      )}
      {error ? (
        <p className="sheet-error" role="alert">
          {error}
        </p>
      ) : null}
      {confirmDelete ? <ConfirmSheet title="Delete permanently?" message={`“${confirmDelete.isPrivate ? 'Private document' : confirmDelete.title}” and its files cannot be recovered after this action.`} confirmLabel="Delete permanently" onConfirm={() => void removePermanently()} onCancel={() => setConfirmDelete(null)} /> : null}
    </div>
  )
}

function SettingsScreen({ documents, onChanged, onOpenTrash }: { documents: VaultDocument[]; onChanged: () => Promise<void>; onOpenTrash: () => void }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const rows = [
    ['Document storage', documentStorageService.usesNativeFiles() ? 'Private app files' : 'Browser test storage'],
    ['Text recognition', 'This device'],
    ['Search indexing', 'This device'],
    ['Analytics', 'None']
  ]
  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" subtitle="Privacy and local storage" />
      <section className="privacy-card">
        <div className="shield">
          <ShieldCheck />
        </div>
        <div>
          <h2>Private by design</h2>
          <p>Documents stay on this device. OCR and search indexing run locally. LOCAL never uploads or synchronises your documents. Only an export or share action you choose sends a copy outside the app.</p>
        </div>
      </section>
      <button className="usage-guide-entry" onClick={() => setGuideOpen((open) => !open)} aria-expanded={guideOpen}>
        <span>
          <CircleHelp />
        </span>
        <div>
          <strong>How to use LOCAL well</strong>
          <small>A quick private-document workflow</small>
        </div>
        {guideOpen ? <ChevronUp /> : <ChevronDown />}
      </button>
      {guideOpen && (
        <section className="usage-guide">
          <ol>
            <li>
              <strong>Scan or import</strong>
              <span>Capture paper with automatic edges, or import an existing PDF.</span>
            </li>
            <li>
              <strong>Review and organise</strong>
              <span>Crop pages, use folders and tags, and let local OCR make everything searchable.</span>
            </li>
            <li>
              <strong>Find it quickly</strong>
              <span>Search words inside documents instead of browsing filenames and cloud drives.</span>
            </li>
            <li>
              <strong>Protect what matters</strong>
              <span>Make sensitive documents private; add a PDF password before exporting when needed.</span>
            </li>
          </ol>
          <p>
            <ShieldCheck /> Faster lookup without an account, subscription, upload delay or server copy.
          </p>
        </section>
      )}
      <StorageSecurityPanel />
      <AppProtectionPanel />
      <BackupPanel />
      <TagManagementPanel documents={documents} onChanged={onChanged} />
      <section className="settings-list">
        <h3>Privacy status</h3>
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              <i />
              {value}
            </strong>
          </div>
        ))}
      </section>
      <button className="usage-guide-entry" onClick={() => setPolicyOpen((open) => !open)} aria-expanded={policyOpen}>
        <span>
          <ShieldCheck />
        </span>
        <div>
          <strong>Privacy policy</strong>
          <small>What LOCAL accesses and stores</small>
        </div>
        {policyOpen ? <ChevronUp /> : <ChevronDown />}
      </button>
      {policyOpen && (
        <section className="usage-guide privacy-policy-summary">
          <p>LOCAL has no account, analytics, advertising, cloud storage or remote OCR. Documents, thumbnails, recognised text and search indexes remain in private app storage. Camera access is used only when you scan. Android may download ML Kit components through Google Play services. Files leave LOCAL only when you explicitly export, share or create an encrypted backup. Removing the app normally removes its private data.</p>
        </section>
      )}
      <button className="usage-guide-entry" onClick={onOpenTrash}>
        <span>
          <Trash2 />
        </span>
        <div>
          <strong>Recently Deleted</strong>
          <small>Restore documents for up to 30 days</small>
        </div>
        <ChevronRight />
      </button>
      <section className="about-card">
        <span>LOCAL</span>
        <small>Version {packageMetadata.version}</small>
        <p>A quiet, private home for your important papers.</p>
      </section>
    </>
  )
}

function TagManagementPanel({ documents, onChanged }: { documents: VaultDocument[]; onChanged: () => Promise<void> }) {
  const tags = useMemo(() => [...new Set(documents.flatMap(document => document.tags))].sort((a, b) => a.localeCompare(b)), [documents])
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(''), [next, setNext] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => { if (selected && !tags.includes(selected)) { setSelected(''); setNext('') } }, [tags, selected])
  const affected = documents.filter(document => document.tags.includes(selected)).length
  const apply = async (remove = false) => {
    const value = next.trim()
    if (!selected || (!remove && !value)) return
    setBusy(true); setMessage('')
    try {
      const updates = documents.filter(document => document.tags.includes(selected)).map(document => ({ ...document, tags: [...new Set(document.tags.flatMap(tag => tag === selected ? remove ? [] : [value] : [tag]))], updatedAt: new Date().toISOString() }))
      await Promise.all(updates.map(document => documentsRepository.save(document)))
      await onChanged(); setMessage(remove ? `Removed “${selected}” from ${updates.length} documents.` : tags.some(tag => tag.toLocaleLowerCase() === value.toLocaleLowerCase() && tag !== selected) ? `Merged “${selected}” into “${value}”.` : `Renamed “${selected}” to “${value}”.`); setSelected(''); setNext(''); setConfirmRemove(false)
    } catch { setMessage('Tags could not be updated. Please try again.') }
    finally { setBusy(false) }
  }
  return <section className="tag-management-card"><button className="tag-management-heading" onClick={() => setOpen(value => !value)} aria-expanded={open}><span><Hash /></span><div><strong>Manage tags</strong><small>Rename, merge or remove labels across the library</small></div>{open ? <ChevronUp /> : <ChevronDown />}</button>{open ? tags.length ? <div className="tag-management-body"><label>Choose tag<select value={selected} onChange={event => { setSelected(event.target.value); setNext(event.target.value) }}><option value="">Select a tag</option>{tags.map(tag => <option key={tag}>{tag}</option>)}</select></label>{selected ? <><small>{affected} document{affected === 1 ? '' : 's'} use this tag</small><label>Rename or merge into<input value={next} onChange={event => setNext(event.target.value)} maxLength={32} /></label><div><button disabled={busy || !next.trim() || next.trim() === selected} onClick={() => void apply()}><Pencil /> Save tag</button><button className="danger" disabled={busy} onClick={() => setConfirmRemove(true)}><Trash2 /> Remove tag</button></div></> : null}{message ? <p role="status">{message}</p> : null}</div> : <p className="tag-management-empty">No tags yet. Add tags from a document or bulk selection.</p> : null}{confirmRemove ? <ConfirmSheet title={`Remove “${selected}”?`} message={`The tag will be removed from ${affected} document${affected === 1 ? '' : 's'}. Documents themselves will not be deleted.`} confirmLabel="Remove tag" onConfirm={() => void apply(true)} onCancel={() => setConfirmRemove(false)} /> : null}</section>
}

function AppProtectionPanel() {
  const [available, setAvailable] = useState(false),
    [enabled, setEnabled] = useState(appLockService.enabled()),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState('')
  useEffect(() => {
    void appLockService
      .available()
      .then(setAvailable)
      .catch(() => setAvailable(false))
      .finally(() => setBusy(false))
  }, [])
  const toggle = async () => {
    setBusy(true)
    setMessage('')
    try {
      await appLockService.authenticate()
      appLockService.setEnabled(!enabled)
      setEnabled(!enabled)
      setMessage(!enabled ? 'LOCAL will lock after 30 seconds in the background.' : 'App lock disabled.')
    } catch {
      setMessage('Authentication was cancelled or unsuccessful.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="protection-card">
      <span>
        <LockKeyhole />
      </span>
      <div>
        <strong>App lock</strong>
        <small>{available ? 'Use fingerprint, face unlock or your device PIN.' : 'Available in the Android app when a secure screen lock is configured.'}</small>
        {message && <em>{message}</em>}
      </div>
      <button role="switch" aria-checked={enabled} disabled={busy || !available} className={enabled ? 'on' : ''} onClick={() => void toggle()}>
        <i />
      </button>
    </section>
  )
}

function AppLockScreen({ checking, onUnlock }: { checking: boolean; onUnlock: () => void }) {
  useEffect(() => {
    void screenSecurityService.setEnabled(true)
    return () => {
      void screenSecurityService.setEnabled(false)
    }
  }, [])
  return (
    <div className="app-lock-screen">
      <div className="brand-mark">
        <Archive />
      </div>
      <h1>LOCAL is locked</h1>
      <p>Your documents remain private until you authenticate.</p>
      <button disabled={checking} onClick={onUnlock}>
        {checking ? <span className="button-spinner" /> : <LockKeyhole />} {checking ? 'Checking…' : 'Unlock LOCAL'}
      </button>
    </div>
  )
}

function BackupPanel() {
  const [mode, setMode] = useState<'idle' | 'create' | 'restore'>('idle'),
    [passphrase, setPassphrase] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [showPassphrase, setShowPassphrase] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [progress, setProgress] = useState(''),
    [summary, setSummary] = useState<Awaited<ReturnType<typeof backupService.summary>> | null>(null),
    [restoreFile, setRestoreFile] = useState<File | null>(null),
    [inspection, setInspection] = useState<{
      payload: BackupPayload
      createdAt: string
      documents: number
      pages: number
      folders: string[]
      conflicts: number
    } | null>(null),
    [policy, setPolicy] = useState<RestoreConflictPolicy>('keep')
  const input = useRef<HTMLInputElement>(null)
  const reset = () => {
    setMode('idle')
    setPassphrase('')
    setConfirmation('')
    setMessage('')
    setProgress('')
    setRestoreFile(null)
    setInspection(null)
    if (input.current) input.current.value = ''
  }
  const beginCreate = async () => {
    setMode('create')
    setMessage('')
    setSummary(await backupService.summary())
  }
  const create = async () => {
    if (passphrase !== confirmation) {
      setMessage('The passphrases do not match.')
      return
    }
    setBusy(true)
    setMessage('Preparing encrypted backup…')
    try {
      const result = await backupService.create(passphrase, (done, total) => setProgress(`Preparing document ${done} of ${total}`))
      setMessage(`${result.count} documents encrypted. Keep the file and passphrase separately.`)
      setProgress('')
      setPassphrase('')
      setConfirmation('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Backup failed.')
    } finally {
      setBusy(false)
    }
  }
  const inspectBackup = async () => {
    if (!restoreFile) return
    setBusy(true)
    setMessage('Unlocking backup safely…')
    try {
      setInspection(await backupService.inspect(restoreFile, passphrase))
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Backup could not be inspected.')
    } finally {
      setBusy(false)
    }
  }
  const restore = async () => {
    if (!inspection) return
    setBusy(true)
    setMessage('Restoring documents…')
    try {
      const result = await backupService.restorePayload(inspection.payload, policy, (done, total) => setProgress(`Restoring document ${done} of ${total}`))
      setMessage(`${result.count} documents restored${result.skipped ? `; ${result.skipped} existing documents kept` : ''}.`)
      setProgress('')
      setInspection(null)
      setPassphrase('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Restore failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="backup-card">
      <div>
        <strong>Encrypted backup</strong>
        <span>Create a user-controlled, password-protected recovery copy. Nothing is uploaded automatically.</span>
      </div>
      {mode === 'idle' ? (
        <div className="backup-actions">
          <button onClick={() => void beginCreate()}>
            <Download /> Create backup
          </button>
          <button onClick={() => input.current?.click()}>
            <Upload /> Restore backup
          </button>
        </div>
      ) : null}
      {mode === 'create' ? (
        <div className="backup-wizard">
          <strong>Create encrypted backup</strong>
          {summary ? (
            <p>
              {summary.documents} documents · {summary.pages} pages · {summary.folders.length} folders
              {summary.privateDocuments ? ` · ${summary.privateDocuments} private` : ''}
            </p>
          ) : (
            <p>Checking library…</p>
          )}
          <p>Includes document images, folders, tags, metadata and searchable text. Device biometric settings are not included.</p>
          <label>
            New passphrase
            <input type={showPassphrase ? 'text' : 'password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
          </label>
          <label>
            Confirm passphrase
            <input type={showPassphrase ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} autoComplete="new-password" placeholder="Enter it again" />
          </label>
          <label className="show-password">
            <input type="checkbox" checked={showPassphrase} onChange={(event) => setShowPassphrase(event.target.checked)} /> Show passphrase
          </label>
          <p className="backup-warning">LOCAL cannot recover this passphrase. Keep it separately from the backup file.</p>
          <div className="backup-actions">
            <button className="quiet" disabled={busy} onClick={reset}>
              Cancel
            </button>
            <button disabled={busy || passphrase.length < 8 || confirmation.length < 8 || !summary} onClick={() => void create()}>
              {busy ? <span className="button-spinner" /> : <Download />} Create and choose location
            </button>
          </div>
        </div>
      ) : null}
      {mode === 'restore' ? (
        <div className="backup-wizard">
          <strong>Restore encrypted backup</strong>
          {restoreFile ? (
            <p>
              {restoreFile.name} · {(restoreFile.size / 1048576).toFixed(1)} MB
            </p>
          ) : null}
          {!inspection ? (
            <>
              <label>
                Backup passphrase
                <input type={showPassphrase ? 'text' : 'password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={8} autoComplete="current-password" placeholder="Passphrase used for this backup" />
              </label>
              <label className="show-password">
                <input type="checkbox" checked={showPassphrase} onChange={(event) => setShowPassphrase(event.target.checked)} /> Show passphrase
              </label>
              <div className="backup-actions">
                <button className="quiet" disabled={busy} onClick={reset}>
                  Cancel
                </button>
                <button disabled={busy || passphrase.length < 8 || !restoreFile} onClick={() => void inspectBackup()}>
                  {busy ? <span className="button-spinner" /> : <ShieldCheck />} Inspect backup
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="backup-preview">
                <strong>
                  {inspection.documents} documents · {inspection.pages} pages
                </strong>
                <span>
                  Created {formatDate(inspection.createdAt)} · {inspection.folders.length} folders
                </span>
                <span>{inspection.conflicts ? `${inspection.conflicts} existing document${inspection.conflicts === 1 ? '' : 's'} have matching IDs` : 'No conflicts found'}</span>
              </div>
              {inspection.conflicts ? (
                <fieldset className="restore-policy">
                  <legend>For matching documents</legend>
                  {(
                    [
                      ['keep', 'Keep current', 'Restore only documents that are not already here'],
                      ['replace', 'Replace current', 'Use the versions from this backup'],
                      ['copy', 'Keep both', 'Restore conflicts as new copies']
                    ] as const
                  ).map(([value, title, detail]) => (
                    <button key={value} className={policy === value ? 'selected' : ''} onClick={() => setPolicy(value)} aria-pressed={policy === value}>
                      <span>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      {policy === value ? <Check /> : null}
                    </button>
                  ))}
                </fieldset>
              ) : null}
              <div className="backup-actions">
                <button className="quiet" disabled={busy} onClick={reset}>
                  Cancel
                </button>
                <button disabled={busy} onClick={() => void restore()}>
                  {busy ? <span className="button-spinner" /> : <RotateCcw />} Restore safely
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <input
        ref={input}
        className="hidden-input"
        type="file"
        accept=".localbackup,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          setRestoreFile(file)
          if (file) {
            setMode('restore')
            setMessage('')
            setInspection(null)
          }
        }}
      />
      {progress ? <p role="status">{progress}</p> : null}
      {message && <p role="status">{message}</p>}
    </section>
  )
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <div className="brand-mark">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </header>
  )
}

function ConfirmSheet({ title, message, confirmLabel, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="tool-sheet-layer" role="presentation" onClick={onCancel}>
      <section className="tool-sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" onClick={(event) => event.stopPropagation()}>
        <span>
          <AlertTriangle />
        </span>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-message">{message}</p>
        <div>
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`nav-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  )
}
function EmptyLoading() {
  return (
    <div className="loading-state">
      <span />
      <span />
      <span />
    </div>
  )
}

export default App
