import { registerSW } from 'virtual:pwa-register'
import { activityBusy } from './activity'

// initPwa registers the service worker and applies updates smoothly: an
// update reloads automatically once the tab is hidden and no transfer is
// in flight. While the tab is visible the caller gets a reload callback
// to surface a manual prompt instead.
export function initPwa(onNeedReload: (reload: () => void) => void) {
  // register after load so the precache fetch never competes with first
  // paint
  const update = registerSW({
    immediate: false,
    onNeedRefresh() {
      const reload = () => void update(true)
      const tryAuto = () => {
        if (document.hidden && !activityBusy()) {
          document.removeEventListener('visibilitychange', onVis)
          reload()
        }
      }
      const onVis = () => tryAuto()
      if (document.hidden && !activityBusy()) {
        reload()
        return
      }
      onNeedReload(reload)
      // auto-apply later when the tab is hidden and idle
      document.addEventListener('visibilitychange', onVis)
    },
  })
}
