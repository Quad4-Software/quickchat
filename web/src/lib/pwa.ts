import { registerSW } from 'virtual:pwa-register'
import { activityBusy, onIdle } from './activity'

// initPwa registers the service worker and keeps deploys fresh. The
// worker self updates (autoUpdate bakes in skipWaiting + clientsClaim)
// so the precache can never stay stuck behind a waiting worker, this
// side only decides when it is safe to reload the tab onto the new
// assets. A reload fires once the tab is hidden and no transfer is in
// flight, otherwise the caller gets a reload callback to surface a
// manual prompt.
export function initPwa(onNeedReload: (reload: () => void) => void) {
  // register after load so the precache fetch never competes with first
  // paint
  registerSW({
    immediate: false,
    // poll frequently and on refocus so a pinned room picks up deploys,
    // the browser alone may not check for a day or more
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => void registration.update()
      // a deploy can land mid-session, poll every minute plus on
      // refocus and network recovery so a pinned room never stays
      // stale for long
      setInterval(check, 60_000)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check()
      })
      window.addEventListener('online', check)
    },
    onNeedReload() {
      const reload = () => location.reload()
      const tryAuto = () => {
        if (document.hidden && !activityBusy()) reload()
      }
      if (document.hidden && !activityBusy()) {
        reload()
        return
      }
      onNeedReload(reload)
      // auto-apply later when the tab is hidden and idle
      document.addEventListener('visibilitychange', tryAuto)
      onIdle(tryAuto)
    },
  })
}
