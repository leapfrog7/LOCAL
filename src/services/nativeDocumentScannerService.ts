import { Capacitor, registerPlugin } from '@capacitor/core'

type NativeScanPage = { uri: string; name: string }
type NativeScanResult = { cancelled: boolean; pages: NativeScanPage[] }
type DocumentScannerPlugin = { scan(): Promise<NativeScanResult> }

const scanner = registerPlugin<DocumentScannerPlugin>('DocumentScanner')

export const nativeDocumentScannerService = {
  available: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',

  async scan() {
    const result = await scanner.scan()
    if (result.cancelled) return { cancelled: true, files: [] as File[] }
    const files = await Promise.all(result.pages.map(async page => {
      const response = await fetch(Capacitor.convertFileSrc(page.uri))
      if (!response.ok) throw new Error(`Could not open ${page.name}.`)
      const blob = await response.blob()
      return new File([blob], page.name, { type: blob.type || 'image/jpeg' })
    }))
    return { cancelled: false, files }
  },
}
