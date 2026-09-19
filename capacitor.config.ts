import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'in.local.vault',
  appName: 'LOCAL',
  webDir: 'dist',
  // Bridge debug logging includes method arguments (passwords and backup data).
  loggingBehavior: 'none',
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: true,
    },
  },
}
export default config
