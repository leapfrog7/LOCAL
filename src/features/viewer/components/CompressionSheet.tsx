import { Check, Minimize2, X } from 'lucide-react'
import { PDF_COMPRESSION, type PdfCompressionLevel } from '../../../services/pdfService'

export function CompressionSheet({ selected, busy, message, error, onSelect, onClose, onCompress }: { selected: PdfCompressionLevel; busy: boolean; message: string; error: string; onSelect: (level: PdfCompressionLevel) => void; onClose: () => void; onCompress: () => void }) {
  return <><header><div><strong>Compress PDF</strong><span>Download a smaller copy; the archived scan stays unchanged</span></div><button onClick={onClose} aria-label="Close"><X /></button></header>
    <div className="compression-options">{Object.entries(PDF_COMPRESSION).map(([id, option]) => <button key={id} className={selected === id ? 'selected' : ''} onClick={() => onSelect(id as PdfCompressionLevel)}><Minimize2 /><span><strong>{option.label}</strong><small>{option.description}</small></span>{selected === id && <Check />}</button>)}</div>
    <p className="tool-note">Compressed copies are not password-protected automatically. Add a password to the new file if required.</p>
    {message && <p className="tool-success" role="status">{message}</p>}{error && <p className="sheet-error" role="alert">{error}</p>}
    <button className="tool-primary" disabled={busy} onClick={onCompress}>{busy ? <span className="button-spinner" /> : <Minimize2 />} {busy ? 'Compressing locally…' : 'Compress and download'}</button>
  </>
}
