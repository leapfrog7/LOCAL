import { Check, FolderOpen, Lock, Tag, Trash2, X } from 'lucide-react'

export type BulkEditMode = 'move' | 'tag'

export function BulkActionBar({ count, busy, error, allPrivate, onMove, onTag, onPrivacy, onDelete, onCancel }: { count: number; busy: boolean; error: string; allPrivate: boolean; onMove: () => void; onTag: () => void; onPrivacy: () => void; onDelete: () => void; onCancel: () => void }) {
  return <aside className="bulk-action-bar" aria-label={`${count} documents selected`}><div><strong>{count} selected</strong><button onClick={onCancel} aria-label="Cancel selection"><X /></button></div>{error ? <p role="alert">{error}</p> : null}<nav><button disabled={busy} onClick={onMove}><FolderOpen /><span>Move</span></button><button disabled={busy} onClick={onTag}><Tag /><span>Tag</span></button><button disabled={busy} onClick={onPrivacy}><Lock /><span>{allPrivate ? 'Public' : 'Private'}</span></button><button disabled={busy} className="danger" onClick={onDelete}><Trash2 /><span>Delete</span></button></nav></aside>
}

export function BulkOrganizeSheet({ mode, count, busy, error, onClose, onApply }: { mode: BulkEditMode; count: number; busy: boolean; error: string; onClose: () => void; onApply: (value: string) => void }) {
  const folders = ['Unfiled', 'Office', 'Personal', 'Receipts', 'Legal']
  return <div className="tool-sheet-layer" onClick={onClose} role="presentation"><section className="tool-sheet bulk-organize-sheet" role="dialog" aria-modal="true" aria-label={mode === 'move' ? 'Move selected documents' : 'Tag selected documents'} onClick={event => event.stopPropagation()}>
    <header><div>{mode === 'move' ? <FolderOpen /> : <Tag />}<span><strong>{mode === 'move' ? 'Move documents' : 'Add a tag'}</strong><small>Apply to {count} selected documents</small></span></div><button onClick={onClose} aria-label="Close"><X /></button></header>
    {mode === 'move' ? <div className="bulk-folder-grid">{folders.map(folder => <button key={folder} disabled={busy} onClick={() => onApply(folder)}><FolderOpen /><span>{folder}</span><Check /></button>)}</div> : <form className="bulk-tag-form" onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('tag'); if (typeof value === 'string' && value.trim()) onApply(value.trim()) }}><label htmlFor="bulk-tag">Tag name</label><input id="bulk-tag" name="tag" maxLength={32} autoFocus placeholder="e.g. Tax 2026" /><button className="tool-primary" disabled={busy}>{busy ? <span className="button-spinner" /> : <Tag />} Add tag to {count}</button></form>}
    {error && <p className="sheet-error" role="alert">{error}</p>}
  </section></div>
}
