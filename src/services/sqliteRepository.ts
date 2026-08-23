import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { DetectedBarcode, DocumentPage, DocumentSmartMetadata, DocumentStatus, OCRWord, PageCorners, PageProcessingState, ProcessingAdjustments, RenderPreset, VaultDocument } from '../domain/types'
import type { ProcessingJob, ProcessingJobStatus, ProcessingJobType } from '../domain/processing'

const DB_NAME = 'local_vault'
const sqlite = new SQLiteConnection(CapacitorSQLite)
let connectionPromise: Promise<SQLiteDBConnection> | undefined
let ftsAvailable = true
let writeQueue: Promise<void> = Promise.resolve()

function serializeWrite<T>(action: () => Promise<T>) {
  const result = writeQueue.then(action, action)
  writeQueue = result.then(() => undefined, () => undefined)
  return result
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS folders (name TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, folder TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]', storage_version INTEGER NOT NULL DEFAULT 1,
  pdf_path TEXT, pdf_generated_at TEXT, processing_stage TEXT, title_source TEXT, smart_metadata_json TEXT,
  is_private INTEGER NOT NULL DEFAULT 0, pdf_password_protected INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, position INTEGER NOT NULL,
  image_path TEXT, original_image_path TEXT, thumbnail_path TEXT, ocr_image_path TEXT,
  rotation INTEGER NOT NULL DEFAULT 0, ocr_text TEXT NOT NULL DEFAULT '', ocr_state TEXT NOT NULL,
  ocr_confidence REAL, ocr_languages TEXT, processing_state TEXT, render_preset TEXT,
  corners_json TEXT, detection_confidence REAL, ocr_words_json TEXT NOT NULL DEFAULT '[]', adjustments_json TEXT, barcodes_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pages_document_position ON pages(document_id, position);
CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, page_id TEXT, type TEXT NOT NULL,
  status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0,
  error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS jobs_status_updated ON processing_jobs(status, updated_at);
`

async function getConnection() {
  if (!Capacitor.isNativePlatform()) throw new Error('SQLite is only enabled in native builds.')
  if (!connectionPromise) connectionPromise = (async () => {
    const existing = await sqlite.isConnection(DB_NAME, false)
    const db = existing.result ? await sqlite.retrieveConnection(DB_NAME, false) : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
    await db.open(); await db.execute(SCHEMA)
    const columns = new Set(((await db.query('PRAGMA table_info(documents)')).values ?? []).map(row => String(row.name)))
    if (!columns.has('pdf_path')) await db.execute('ALTER TABLE documents ADD COLUMN pdf_path TEXT;')
    if (!columns.has('pdf_generated_at')) await db.execute('ALTER TABLE documents ADD COLUMN pdf_generated_at TEXT;')
    if (!columns.has('processing_stage')) await db.execute('ALTER TABLE documents ADD COLUMN processing_stage TEXT;')
    if (!columns.has('title_source')) await db.execute('ALTER TABLE documents ADD COLUMN title_source TEXT;')
    if (!columns.has('smart_metadata_json')) await db.execute('ALTER TABLE documents ADD COLUMN smart_metadata_json TEXT;')
    if (!columns.has('is_private')) await db.execute('ALTER TABLE documents ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;')
    if (!columns.has('pdf_password_protected')) await db.execute('ALTER TABLE documents ADD COLUMN pdf_password_protected INTEGER NOT NULL DEFAULT 0;')
    const pageColumns = new Set(((await db.query('PRAGMA table_info(pages)')).values ?? []).map(row => String(row.name)))
    if (!pageColumns.has('ocr_words_json')) await db.execute("ALTER TABLE pages ADD COLUMN ocr_words_json TEXT NOT NULL DEFAULT '[]';")
    if (!pageColumns.has('adjustments_json')) await db.execute('ALTER TABLE pages ADD COLUMN adjustments_json TEXT;')
    if (!pageColumns.has('barcodes_json')) await db.execute("ALTER TABLE pages ADD COLUMN barcodes_json TEXT NOT NULL DEFAULT '[]';")
    await db.execute('PRAGMA user_version = 7;')
    try { await db.execute('CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(document_id UNINDEXED, title, folder, ocr_text);') }
    catch { ftsAvailable = false }
    return db
  })()
  return connectionPromise
}

type Row = Record<string, unknown>
const text = (value: unknown) => typeof value === 'string' ? value : ''
const optionalText = (value: unknown) => typeof value === 'string' && value ? value : undefined
const number = (value: unknown) => typeof value === 'number' ? value : Number(value || 0)
const parseJson = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(text(value)) as T } catch { return fallback } }

function pageFromRow(row: Row): DocumentPage {
  return {
    id: text(row.id), imageUrl: '', imagePath: optionalText(row.image_path), originalImagePath: optionalText(row.original_image_path),
    thumbnailPath: optionalText(row.thumbnail_path), ocrImagePath: optionalText(row.ocr_image_path), rotation: number(row.rotation),
    ocrText: text(row.ocr_text), ocrState: text(row.ocr_state) as DocumentPage['ocrState'],
    ocrConfidence: row.ocr_confidence == null ? undefined : number(row.ocr_confidence),
    ocrLanguages: parseJson<string[]>(row.ocr_languages, []),
    processingState: optionalText(row.processing_state) as PageProcessingState | undefined,
    renderPreset: optionalText(row.render_preset) as RenderPreset | undefined,
    corners: parseJson<PageCorners | undefined>(row.corners_json, undefined),
    detectionConfidence: row.detection_confidence == null ? undefined : number(row.detection_confidence),
    ocrWords: parseJson<OCRWord[]>(row.ocr_words_json, []), adjustments: parseJson<ProcessingAdjustments | undefined>(row.adjustments_json, undefined), barcodes: parseJson<DetectedBarcode[]>(row.barcodes_json, []),
  }
}

async function documentsFromRows(rows: Row[]) {
  const db = await getConnection(), documents: VaultDocument[] = []
  for (const row of rows) {
    const pageRows = (await db.query('SELECT * FROM pages WHERE document_id = ? ORDER BY position', [text(row.id)])).values ?? []
    documents.push({ id: text(row.id), storageVersion: number(row.storage_version), title: text(row.title), titleSource: optionalText(row.title_source) as VaultDocument['titleSource'], smartMetadata: parseJson<DocumentSmartMetadata | undefined>(row.smart_metadata_json, undefined), folder: text(row.folder), createdAt: text(row.created_at), updatedAt: text(row.updated_at), status: text(row.status) as DocumentStatus, tags: parseJson<string[]>(row.tags_json, []), isPrivate: number(row.is_private) === 1, pdfPasswordProtected: number(row.pdf_password_protected) === 1, pdfPath: optionalText(row.pdf_path), pdfGeneratedAt: optionalText(row.pdf_generated_at), processingStage: optionalText(row.processing_stage) as VaultDocument['processingStage'], pages: pageRows.map(pageFromRow) })
  }
  return documents
}

async function refreshSearchIndex(db: SQLiteDBConnection, document: VaultDocument) {
  if (!ftsAvailable) return
  await db.run('DELETE FROM document_search WHERE document_id = ?', [document.id], false)
  await db.run('INSERT INTO document_search(document_id, title, folder, ocr_text) VALUES (?, ?, ?, ?)', [document.id, [document.title, ...document.tags, ...Object.values(document.smartMetadata ?? {}).flatMap(value => typeof value === 'object' && value ? Object.values(value) : String(value ?? ''))].join(' '), document.folder, document.pages.flatMap(page => [page.ocrText, ...(page.barcodes ?? []).flatMap(code => [code.rawValue, code.displayValue ?? ''])]).join('\n')], false)
}

export const sqliteRepository = {
  available: () => Capacitor.isNativePlatform(),

  async list() {
    const db = await getConnection(), rows = (await db.query('SELECT * FROM documents ORDER BY updated_at DESC')).values ?? []
    return documentsFromRows(rows)
  },

  async get(id: string) {
    const db = await getConnection(), rows = (await db.query('SELECT * FROM documents WHERE id = ?', [id])).values ?? []
    return (await documentsFromRows(rows))[0]
  },

  async save(document: VaultDocument) {
    return serializeWrite(async () => {
      const db = await getConnection()
      await db.execute('BEGIN TRANSACTION;', false)
      try {
        await db.run(`INSERT INTO documents(id,title,folder,created_at,updated_at,status,tags_json,storage_version,pdf_path,pdf_generated_at,processing_stage,title_source,smart_metadata_json,is_private,pdf_password_protected) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,folder=excluded.folder,updated_at=excluded.updated_at,status=excluded.status,tags_json=excluded.tags_json,storage_version=excluded.storage_version,pdf_path=excluded.pdf_path,pdf_generated_at=excluded.pdf_generated_at,processing_stage=excluded.processing_stage,title_source=excluded.title_source,smart_metadata_json=excluded.smart_metadata_json,is_private=excluded.is_private,pdf_password_protected=excluded.pdf_password_protected`,
        [document.id, document.title, document.folder, document.createdAt, document.updatedAt, document.status, JSON.stringify(document.tags), document.storageVersion ?? 1, document.pdfPath ?? null, document.pdfGeneratedAt ?? null, document.processingStage ?? null, document.titleSource ?? null, document.smartMetadata ? JSON.stringify(document.smartMetadata) : null, document.isPrivate ? 1 : 0, document.pdfPasswordProtected ? 1 : 0], false)
        await db.run('INSERT OR IGNORE INTO folders(name, created_at) VALUES(?, ?)', [document.folder, document.createdAt], false)
        for (const [position, page] of document.pages.entries()) await db.run(`INSERT INTO pages(id,document_id,position,image_path,original_image_path,thumbnail_path,ocr_image_path,rotation,ocr_text,ocr_state,ocr_confidence,ocr_languages,processing_state,render_preset,corners_json,detection_confidence,ocr_words_json,adjustments_json,barcodes_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET position=excluded.position,image_path=excluded.image_path,original_image_path=excluded.original_image_path,thumbnail_path=excluded.thumbnail_path,ocr_image_path=excluded.ocr_image_path,rotation=excluded.rotation,ocr_text=excluded.ocr_text,ocr_state=excluded.ocr_state,ocr_confidence=excluded.ocr_confidence,ocr_languages=excluded.ocr_languages,processing_state=excluded.processing_state,render_preset=excluded.render_preset,corners_json=excluded.corners_json,detection_confidence=excluded.detection_confidence,ocr_words_json=excluded.ocr_words_json,adjustments_json=excluded.adjustments_json,barcodes_json=excluded.barcodes_json`,
          [page.id, document.id, position, page.imagePath ?? null, page.originalImagePath ?? null, page.thumbnailPath ?? null, page.ocrImagePath ?? null, page.rotation, page.ocrText, page.ocrState, page.ocrConfidence ?? null, JSON.stringify(page.ocrLanguages ?? []), page.processingState ?? null, page.renderPreset ?? null, page.corners ? JSON.stringify(page.corners) : null, page.detectionConfidence ?? null, JSON.stringify(page.ocrWords ?? []), page.adjustments ? JSON.stringify(page.adjustments) : null, JSON.stringify(page.barcodes ?? [])], false)
        if (document.pages.length) {
          const placeholders = document.pages.map(() => '?').join(',')
          await db.run(`DELETE FROM pages WHERE document_id = ? AND id NOT IN (${placeholders})`, [document.id, ...document.pages.map(page => page.id)], false)
        } else await db.run('DELETE FROM pages WHERE document_id = ?', [document.id], false)
        await refreshSearchIndex(db, document)
        await db.execute('COMMIT;', false)
      } catch (error) { await db.execute('ROLLBACK;', false); throw error }
    })
  },

  async remove(id: string) {
    const db = await getConnection(); await db.run('DELETE FROM documents WHERE id = ?', [id]); if (ftsAvailable) await db.run('DELETE FROM document_search WHERE document_id = ?', [id])
  },

  async search(query: string) {
    const db = await getConnection(), terms = query.trim().split(/\s+/).filter(Boolean)
    if (!terms.length) return this.list()
    if (ftsAvailable) {
      const match = terms.map(term => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
      const rows = (await db.query('SELECT d.* FROM document_search s JOIN documents d ON d.id=s.document_id WHERE document_search MATCH ? ORDER BY bm25(document_search), d.updated_at DESC', [match])).values ?? []
      return documentsFromRows(rows)
    }
    const needle = `%${terms.join('%')}%`
    const rows = (await db.query(`SELECT DISTINCT d.* FROM documents d LEFT JOIN pages p ON p.document_id=d.id WHERE lower(d.title || ' ' || d.folder || ' ' || d.tags_json || ' ' || coalesce(d.smart_metadata_json,'') || ' ' || coalesce(p.ocr_text,'')) LIKE lower(?) ORDER BY d.updated_at DESC`, [needle])).values ?? []
    return documentsFromRows(rows)
  },

  async getSetting(key: string) { const db = await getConnection(), row = ((await db.query('SELECT value FROM settings WHERE key = ?', [key])).values ?? [])[0]; return row ? text(row.value) : undefined },
  async setSetting(key: string, value: string) { const db = await getConnection(); await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]) },

  async upsertJob(job: ProcessingJob) {
    return serializeWrite(async () => {
      const db = await getConnection(); await db.run(`INSERT INTO processing_jobs(id,document_id,page_id,type,status,attempts,progress,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,progress=excluded.progress,error=excluded.error,updated_at=excluded.updated_at`,
      [job.id, job.documentId, job.pageId ?? null, job.type, job.status, job.attempts, job.progress, job.error ?? null, job.createdAt, job.updatedAt], false)
    })
  },
  async pendingJobs() {
    return serializeWrite(async () => {
      const db = await getConnection(); await db.run("UPDATE processing_jobs SET status='pending' WHERE status='processing'", [], false)
      const rows = (await db.query("SELECT * FROM processing_jobs WHERE status='pending' OR (status='error' AND attempts < 3) ORDER BY created_at")).values ?? []
      return rows.map(row => ({ id: text(row.id), documentId: text(row.document_id), pageId: optionalText(row.page_id), type: text(row.type) as ProcessingJobType, status: text(row.status) as ProcessingJobStatus, attempts: number(row.attempts), progress: number(row.progress), error: optionalText(row.error), createdAt: text(row.created_at), updatedAt: text(row.updated_at) }))
    })
  },
  async cancelJobs(documentId: string) { return serializeWrite(async () => { const db = await getConnection(); await db.run("UPDATE processing_jobs SET status='cancelled', updated_at=? WHERE document_id=? AND status IN ('pending','processing')", [new Date().toISOString(), documentId], false) }) },
  async jobsCancelled(documentId: string) { const db = await getConnection(); const rows = (await db.query("SELECT status FROM processing_jobs WHERE document_id=?", [documentId])).values ?? []; return rows.some(row => text(row.status) === 'cancelled') && rows.every(row => ['cancelled', 'complete'].includes(text(row.status))) },
}
