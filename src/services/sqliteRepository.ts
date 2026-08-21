import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { DocumentPage, DocumentStatus, PageCorners, PageProcessingState, RenderPreset, VaultDocument } from '../domain/types'
import type { ProcessingJob, ProcessingJobStatus, ProcessingJobType } from '../domain/processing'

const DB_NAME = 'local_vault'
const sqlite = new SQLiteConnection(CapacitorSQLite)
let connectionPromise: Promise<SQLiteDBConnection> | undefined
let ftsAvailable = true

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS folders (name TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, folder TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]', storage_version INTEGER NOT NULL DEFAULT 1,
  pdf_path TEXT, pdf_generated_at TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, position INTEGER NOT NULL,
  image_path TEXT, original_image_path TEXT, thumbnail_path TEXT, ocr_image_path TEXT,
  rotation INTEGER NOT NULL DEFAULT 0, ocr_text TEXT NOT NULL DEFAULT '', ocr_state TEXT NOT NULL,
  ocr_confidence REAL, ocr_languages TEXT, processing_state TEXT, render_preset TEXT,
  corners_json TEXT, detection_confidence REAL,
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
    await db.execute('PRAGMA user_version = 2;')
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
  }
}

async function documentsFromRows(rows: Row[]) {
  const db = await getConnection(), documents: VaultDocument[] = []
  for (const row of rows) {
    const pageRows = (await db.query('SELECT * FROM pages WHERE document_id = ? ORDER BY position', [text(row.id)])).values ?? []
    documents.push({ id: text(row.id), storageVersion: number(row.storage_version), title: text(row.title), folder: text(row.folder), createdAt: text(row.created_at), updatedAt: text(row.updated_at), status: text(row.status) as DocumentStatus, tags: parseJson<string[]>(row.tags_json, []), pdfPath: optionalText(row.pdf_path), pdfGeneratedAt: optionalText(row.pdf_generated_at), pages: pageRows.map(pageFromRow) })
  }
  return documents
}

async function refreshSearchIndex(db: SQLiteDBConnection, document: VaultDocument) {
  if (!ftsAvailable) return
  await db.run('DELETE FROM document_search WHERE document_id = ?', [document.id], false)
  await db.run('INSERT INTO document_search(document_id, title, folder, ocr_text) VALUES (?, ?, ?, ?)', [document.id, document.title, document.folder, document.pages.map(page => page.ocrText).join('\n')], false)
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
    const db = await getConnection()
    await db.execute('BEGIN TRANSACTION;', false)
    try {
      await db.run(`INSERT INTO documents(id,title,folder,created_at,updated_at,status,tags_json,storage_version,pdf_path,pdf_generated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,folder=excluded.folder,updated_at=excluded.updated_at,status=excluded.status,tags_json=excluded.tags_json,storage_version=excluded.storage_version,pdf_path=excluded.pdf_path,pdf_generated_at=excluded.pdf_generated_at`,
      [document.id, document.title, document.folder, document.createdAt, document.updatedAt, document.status, JSON.stringify(document.tags), document.storageVersion ?? 1, document.pdfPath ?? null, document.pdfGeneratedAt ?? null], false)
      await db.run('INSERT OR IGNORE INTO folders(name, created_at) VALUES(?, ?)', [document.folder, document.createdAt], false)
      await db.run('DELETE FROM pages WHERE document_id = ?', [document.id], false)
      for (const [position, page] of document.pages.entries()) await db.run(`INSERT INTO pages(id,document_id,position,image_path,original_image_path,thumbnail_path,ocr_image_path,rotation,ocr_text,ocr_state,ocr_confidence,ocr_languages,processing_state,render_preset,corners_json,detection_confidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [page.id, document.id, position, page.imagePath ?? null, page.originalImagePath ?? null, page.thumbnailPath ?? null, page.ocrImagePath ?? null, page.rotation, page.ocrText, page.ocrState, page.ocrConfidence ?? null, JSON.stringify(page.ocrLanguages ?? []), page.processingState ?? null, page.renderPreset ?? null, page.corners ? JSON.stringify(page.corners) : null, page.detectionConfidence ?? null], false)
      await refreshSearchIndex(db, document)
      await db.execute('COMMIT;', false)
    } catch (error) { await db.execute('ROLLBACK;', false); throw error }
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
    const rows = (await db.query(`SELECT DISTINCT d.* FROM documents d LEFT JOIN pages p ON p.document_id=d.id WHERE lower(d.title || ' ' || d.folder || ' ' || coalesce(p.ocr_text,'')) LIKE lower(?) ORDER BY d.updated_at DESC`, [needle])).values ?? []
    return documentsFromRows(rows)
  },

  async getSetting(key: string) { const db = await getConnection(), row = ((await db.query('SELECT value FROM settings WHERE key = ?', [key])).values ?? [])[0]; return row ? text(row.value) : undefined },
  async setSetting(key: string, value: string) { const db = await getConnection(); await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]) },

  async upsertJob(job: ProcessingJob) {
    const db = await getConnection(); await db.run(`INSERT INTO processing_jobs(id,document_id,page_id,type,status,attempts,progress,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,progress=excluded.progress,error=excluded.error,updated_at=excluded.updated_at`,
    [job.id, job.documentId, job.pageId ?? null, job.type, job.status, job.attempts, job.progress, job.error ?? null, job.createdAt, job.updatedAt])
  },
  async pendingJobs() {
    const db = await getConnection(); await db.run("UPDATE processing_jobs SET status='pending' WHERE status='processing'")
    const rows = (await db.query("SELECT * FROM processing_jobs WHERE status='pending' OR (status='error' AND attempts < 3) ORDER BY created_at")).values ?? []
    return rows.map(row => ({ id: text(row.id), documentId: text(row.document_id), pageId: optionalText(row.page_id), type: text(row.type) as ProcessingJobType, status: text(row.status) as ProcessingJobStatus, attempts: number(row.attempts), progress: number(row.progress), error: optionalText(row.error), createdAt: text(row.created_at), updatedAt: text(row.updated_at) }))
  },
  async cancelJobs(documentId: string) { const db = await getConnection(); await db.run("UPDATE processing_jobs SET status='cancelled', updated_at=? WHERE document_id=? AND status IN ('pending','processing')", [new Date().toISOString(), documentId]) },
  async jobsCancelled(documentId: string) { const db = await getConnection(); const rows = (await db.query("SELECT status FROM processing_jobs WHERE document_id=?", [documentId])).values ?? []; return rows.some(row => text(row.status) === 'cancelled') && rows.every(row => ['cancelled', 'complete'].includes(text(row.status))) },
}
