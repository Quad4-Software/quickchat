// SPDX-License-Identifier: 0BSD
// Desktop shell bridge. Inside the wails app the platform layer
// exposes window._wails.invoke on any origin, which the app uses to
// persist the chosen server and to raise native notifications on
// platforms without the web Notification api. Everything degrades to
// no-ops in a plain browser.

declare global {
  interface Window {
    _wails?: { invoke(message: string): void }
  }
}

export const isDesktop = () => typeof window._wails?.invoke === 'function'

function invoke(msg: string) {
  try {
    window._wails?.invoke(msg)
  } catch {
    // the channel is best effort only
  }
}

// hello pings the shell once at boot so both sides learn whether the
// invoke channel reaches the host on this platform. The platform
// injects _wails asynchronously so probe a few times before giving up.
export function hello() {
  let tries = 0
  const tick = () => {
    if (isDesktop()) {
      invoke('qc:hello')
      return
    }
    if (++tries < 20) setTimeout(tick, 250)
  }
  tick()
}

// notify sends a native os notification through the desktop shell.
// Webviews with their own Notification api keep using it since the
// bridge simply no-ops on platforms it does not cover.
export function notifyDesktop(title: string, body: string) {
  invoke(
    'qc:notify:' +
      btoa(unescape(encodeURIComponent(JSON.stringify({ t: title, b: body })))),
  )
}

// chooseServer stores the choice in the desktop shell when available
// and returns what the caller should do next: navigate to the returned
// url, stay put for a local switch, or reject the input.
export function chooseServer(raw: string): string {
  const url = normalizeServer(raw)
  if (!url) return ''
  if (isDesktop()) invoke('qc:server:' + encodeURIComponent(url))
  return url
}

// normalizeServer accepts a host, url or the local keyword and returns
// a clean origin, or empty for invalid input.
export function normalizeServer(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '')
  if (!s) return ''
  if (s === 'local') return 'local'
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    return new URL(withScheme).origin
  } catch {
    return ''
  }
}
