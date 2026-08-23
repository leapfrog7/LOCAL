import { useState } from 'react'
import { Check, Plus, Tag, X } from 'lucide-react'

const SUGGESTIONS = ['Important', 'Tax', 'Warranty', 'Medical', 'Work', 'Personal', 'To review']
const cleanTag = (value: string) => value.replace(/[,#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32)

export function TagEditorSheet({ initialTags, busy, error, onClose, onSave }: { initialTags: string[]; busy: boolean; error: string; onClose: () => void; onSave: (tags: string[]) => void }) {
  const [tags, setTags] = useState(() => [...initialTags])
  const [input, setInput] = useState('')
  const add = (value = input) => {
    const tag = cleanTag(value)
    if (!tag || tags.some(current => current.toLocaleLowerCase() === tag.toLocaleLowerCase())) return
    setTags(current => [...current, tag]); setInput('')
  }
  const remove = (tag: string) => setTags(current => current.filter(value => value !== tag))
  return <><header><div><strong>Document tags</strong><span>Add searchable labels without changing folders</span></div><button onClick={onClose} aria-label="Close"><X /></button></header>
    <form className="tag-input" onSubmit={event => { event.preventDefault(); add() }}><label htmlFor="document-tag">New tag</label><div><input id="document-tag" value={input} onChange={event => setInput(event.target.value)} maxLength={32} placeholder="e.g. Tax 2026" /><button disabled={!cleanTag(input)} aria-label="Add tag"><Plus /></button></div></form>
    {tags.length ? <div className="active-tags" aria-label="Current tags">{tags.map(tag => <button key={tag} onClick={() => remove(tag)} aria-label={`Remove ${tag}`}><Tag />{tag}<X /></button>)}</div> : <p className="tool-note">No tags yet. Add one below or choose a suggestion.</p>}
    <div className="tag-suggestions"><span>Suggestions</span><div>{SUGGESTIONS.filter(tag => !tags.some(current => current.toLocaleLowerCase() === tag.toLocaleLowerCase())).map(tag => <button key={tag} onClick={() => add(tag)}><Plus /> {tag}</button>)}</div></div>
    {error && <p className="sheet-error" role="alert">{error}</p>}
    <button className="tool-primary" disabled={busy} onClick={() => onSave(tags)}>{busy ? <span className="button-spinner" /> : <Check />} {busy ? 'Saving tags…' : 'Save tags'}</button>
  </>
}
