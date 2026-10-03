// SPDX-License-Identifier: 0BSD
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ACTIONS, comboOf, loadBinds, resetBinds, saveBinds } from '../lib/keybinds'
import type { ActionId } from '../lib/keybinds'

// KeybindsModal lists every bindable action and captures a new combo
// when a row is armed
export default function KeybindsModal({ onClose }: { onClose: () => void }) {
  const [binds, setBinds] = useState<Record<ActionId, string>>(loadBinds)
  const [armed, setArmed] = useState<ActionId | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (armed) setArmed(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  }, [armed, onClose])

  const capture = (e: React.KeyboardEvent) => {
    if (!armed) return
    const combo = comboOf(e.nativeEvent)
    if (!combo) return
    e.preventDefault()
    const next = { ...binds, [armed]: combo }
    setBinds(next)
    saveBinds(next)
    setArmed(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={capture}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl"
      >
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-sm font-semibold text-emphasis">keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="close shortcuts"
            className="rounded-md p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <ul className="space-y-1">
          {ACTIONS.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{a.label}</span>
              <button
                onClick={() => setArmed(armed === a.id ? null : a.id)}
                aria-label={`shortcut for ${a.label}`}
                aria-pressed={armed === a.id}
                className={`min-w-16 rounded-md border px-2 py-1 font-mono text-[11px] ${
                  armed === a.id
                    ? 'border-border-strong bg-hover text-emphasis'
                    : 'border-border bg-recessed text-foreground hover:bg-hover'
                }`}
              >
                {armed === a.id ? 'press keys' : binds[a.id]}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            resetBinds()
            setBinds(loadBinds())
          }}
          className="mt-3 w-full rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          reset to defaults
        </button>
      </div>
    </div>
  )
}
