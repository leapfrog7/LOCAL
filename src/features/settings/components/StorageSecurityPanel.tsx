import { useEffect, useState } from 'react'
import { Database, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { sqliteRepository } from '../../../services/sqliteRepository'

export function StorageSecurityPanel() {
  const [encrypted, setEncrypted] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void sqliteRepository.securityStatus()
      .then(status => { if (active) setEncrypted(status.databaseEncrypted) })
      .catch(() => { if (active) setEncrypted(false) })
    return () => { active = false }
  }, [])

  return <section className="storage-security-card">
    <header><span><ShieldCheck /></span><div><strong>Storage protection</strong><small>Applied automatically on this Android device.</small></div></header>
    <div><Database /><span><strong>Searchable library</strong><small>Titles, OCR text, tags and metadata</small></span><b className={encrypted === false ? 'warning' : ''}>{encrypted === null ? 'Checking…' : encrypted ? 'Encrypted' : 'Unavailable'}</b></div>
    <div><KeyRound /><span><strong>Private document files</strong><small>Pages and PDFs use an Android Keystore key</small></span><b>AES-GCM</b></div>
    <div><LockKeyhole /><span><strong>Private document screens</strong><small>Blocked from screenshots and recent-app thumbnails</small></span><b>Protected</b></div>
  </section>
}
