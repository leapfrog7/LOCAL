import { Capacitor, registerPlugin } from '@capacitor/core'

type BiometricPlugin = {
  availability(): Promise<{ available: boolean; reason: number }>
  authenticate(): Promise<void>
}
const nativeBiometric = registerPlugin<BiometricPlugin>('BiometricLock')
const KEY = 'local.biometric-lock.enabled'

export const appLockService = {
  enabled: () => localStorage.getItem(KEY) === '1',
  async available() { return Capacitor.isNativePlatform() && (await nativeBiometric.availability()).available },
  async authenticate() { if (!Capacitor.isNativePlatform()) throw new Error('App lock is available in the Android app.'); await nativeBiometric.authenticate() },
  setEnabled(enabled: boolean) { if (enabled) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) },
}
