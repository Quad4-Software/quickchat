// SPDX-License-Identifier: 0BSD
// Editable keyboard shortcuts stored in localStorage as a
// action -> combo map. Combos are lowercase like ctrl+shift+m.
// A custom event lets open listeners reload the map after an edit.

const KEY = 'qc-keys'
export const BINDS_CHANGED = 'qc-keys-changed'

export type ActionId = 'mic' | 'camera' | 'share' | 'composer' | 'debug' | 'shortcuts'

export const ACTIONS: { id: ActionId; label: string; def: string }[] = [
  { id: 'mic', label: 'toggle microphone', def: 'm' },
  { id: 'camera', label: 'toggle camera', def: 'c' },
  { id: 'share', label: 'toggle screen share', def: 's' },
  { id: 'composer', label: 'focus message box', def: '/' },
  { id: 'debug', label: 'connection stats', def: 'd' },
  { id: 'shortcuts', label: 'open shortcuts', def: 'k' },
]

export function loadBinds(): Record<ActionId, string> {
  let saved: Record<string, string>
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    saved = {}
  }
  const out = {} as Record<ActionId, string>
  for (const a of ACTIONS) out[a.id] = saved[a.id] ?? a.def
  return out
}

export function saveBinds(map: Partial<Record<ActionId, string>>) {
  localStorage.setItem(KEY, JSON.stringify(map))
  window.dispatchEvent(new Event(BINDS_CHANGED))
}

export function resetBinds() {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new Event(BINDS_CHANGED))
}

// comboOf renders a keydown as a canonical combo, pure modifier
// presses return ''
export function comboOf(e: KeyboardEvent): string {
  const k = e.key.toLowerCase()
  if (k === 'control' || k === 'meta' || k === 'shift' || k === 'alt') return ''
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(k === ' ' ? 'space' : k)
  return parts.join('+')
}

export function matchBind(e: KeyboardEvent, combo: string): boolean {
  return Boolean(combo) && comboOf(e) === combo
}

// isTextTarget guards against firing global binds while typing
export function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}
