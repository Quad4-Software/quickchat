// SPDX-License-Identifier: 0BSD
import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Disc3,
  Drumstick,
  Megaphone,
  Music,
  Music2,
  PartyPopper,
  Plus,
  Siren,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { decodeFile, preset, SOUNDS } from '../lib/soundboard'

const ICONS: Record<string, LucideIcon> = {
  siren: Siren,
  bugle: Megaphone,
  drumroll: Drumstick,
  tada: PartyPopper,
  ding: Bell,
  pop: Sparkles,
  boing: Music2,
  cowbell: Disc3,
}

interface Custom {
  name: string
  b64: string
}

const STORE = 'qc-sounds'

function loadCustoms(): Custom[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '[]') as Custom[]
  } catch {
    return []
  }
}

function saveCustoms(list: Custom[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list))
  } catch {
    // quota full: keep the sound for this session anyway
  }
}

// Soundboard pads play sounds into the room as a temporary audio
// track. buffers resolve through onPlay which owns publishing
export default function Soundboard({
  onPlay,
  disabled,
}: {
  onPlay: (buffer: AudioBuffer, label: string) => void
  disabled?: boolean | undefined
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null)
  const [customs, setCustoms] = useState<Custom[]>(loadCustoms)
  const [busy, setBusy] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const hit = (
    kind: 'preset' | 'custom',
    s: { id?: string; name: string; b64?: string },
  ) => {
    if (disabled || busy) return
    setBusy(s.name)
    const resolve =
      kind === 'preset'
        ? preset(s.id ?? '')
        : decodeFile(Uint8Array.from(atob(s.b64 ?? ''), (c) => c.charCodeAt(0)).buffer)
    void resolve
      .then((buf) => onPlay(buf, s.name))
      .catch(() => {})
      .finally(() => setBusy(''))
  }

  const addSound = (f: File) => {
    if (f.size > 900_000) return // localStorage stays light
    const rd = new FileReader()
    rd.onload = () => {
      const b64 = String(rd.result).split(',')[1] ?? ''
      const next = [...customs, { name: f.name.replace(/\.[a-z0-9]+$/i, ''), b64 }]
      setCustoms(next)
      saveCustoms(next)
    }
    rd.readAsDataURL(f)
  }

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({
        bottom: window.innerHeight - r.top + 8,
        right: window.innerWidth - r.right,
      })
    }
    setOpen(!open)
  }

  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="soundboard"
        aria-expanded={open}
        title="soundboard"
        className="rounded-md border border-border bg-card p-2.5 text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Music className="size-4" aria-hidden />
      </button>
      {open && pos && (
        <div
          role="dialog"
          aria-label="soundboard"
          style={{ bottom: pos.bottom, right: pos.right }}
          className="fixed z-50 grid w-56 grid-cols-2 gap-1.5 rounded-md border border-border bg-card p-2 shadow-md"
        >
          {SOUNDS.map((s) => {
            const Icon = ICONS[s.id] ?? Music
            return (
              <button
                key={s.id}
                onClick={() => hit('preset', { id: s.id, name: s.label })}
                disabled={Boolean(disabled) || busy === s.label}
                className="flex flex-col items-center gap-1 rounded-md border border-border bg-recessed px-2 py-2 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
              >
                <Icon className="size-4" aria-hidden />
                {busy === s.label ? 'playing' : s.label}
              </button>
            )
          })}
          {customs.map((s) => (
            <div key={s.name} className="group relative">
              <button
                onClick={() => hit('custom', { name: s.name, b64: s.b64 })}
                disabled={Boolean(disabled) || busy === s.name}
                className="w-full truncate rounded-md border border-border bg-recessed px-2 py-2 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
              >
                {busy === s.name ? 'playing' : s.name}
              </button>
              <button
                onClick={() => {
                  const next = customs.filter((x) => x !== s)
                  setCustoms(next)
                  saveCustoms(next)
                }}
                aria-label={`remove ${s.name}`}
                className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-dim hover:text-destructive group-hover:block"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </div>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden />
            add a sound
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) addSound(f)
              e.target.value = ''
            }}
          />
        </div>
      )}
    </div>
  )
}
