// activity tracks in-flight work (file transfers) so the pwa updater can
// avoid reloading the page mid-transfer
let pending = 0
const listeners = new Set<() => void>()

export function activityBegin() {
  pending++
}

export function activityEnd() {
  pending = Math.max(0, pending - 1)
  if (pending === 0) listeners.forEach((f) => f())
}

export function activityBusy(): boolean {
  return pending > 0
}

// onIdle fires once when nothing is in flight
export function onIdle(f: () => void) {
  if (pending === 0) {
    f()
    return
  }
  const wrap = () => {
    listeners.delete(wrap)
    f()
  }
  listeners.add(wrap)
}
