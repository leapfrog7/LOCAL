import { appLockService } from './appLockService'

export const screenSecurityService = {
  async setEnabled(enabled: boolean) {
    await appLockService.setScreenSecure(enabled)
  },
}
