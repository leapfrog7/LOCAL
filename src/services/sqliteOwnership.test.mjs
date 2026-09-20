import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

it('production SQLite schema rejects cross-owner UPSERTs and preserves existing pages', () => {
  const source = readFileSync(new URL('./sqliteRepository.ts', import.meta.url), 'utf8')
  const schema = source.match(/const SCHEMA = `([\s\S]*?)`/)[1]
  const sql = source.match(/`(INSERT INTO pages\([\s\S]*?)`/)[1]
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(schema)
    const doc = db.prepare('INSERT INTO documents(id,title,folder,created_at,updated_at,status) VALUES(?,?,?,?,?,?)')
    for (const id of ['victim', 'incoming']) doc.run(id,id,'Unfiled','2026-09-20','2026-09-20','indexed')
    const values = (owner, text) => ['shared-page',owner,0,null,null,null,null,0,text,'complete',null,'[]',null,null,null,null,'[]',null,'[]',null]
    const insert = db.prepare(sql)
    insert.run(...values('victim','original'))
    expect(() => insert.run(...values('incoming','tampered'))).toThrow('Page belongs to another document')
    expect(db.prepare('SELECT document_id,ocr_text FROM pages').get()).toMatchObject({ document_id: 'victim', ocr_text: 'original' })
    insert.run(...values('victim','legitimate edit'))
    expect(db.prepare('SELECT ocr_text FROM pages').get().ocr_text).toBe('legitimate edit')
  } finally { db.close() }
})
