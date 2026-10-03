// SPDX-License-Identifier: 0BSD
import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { resizeAvatar } from '../lib/profile'
import Avatar from '../components/Avatar'

// ProfileEditor edits the local display name and avatar, saved to
// localStorage and broadcast to peers by the callbacks
export default function ProfileEditor({
  name,
  avatar,
  onName,
  onAvatar,
  onReset,
}: {
  name: string
  avatar?: string | undefined
  onName: (next: string) => void
  onAvatar: (data: string) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [draft, setDraft] = useState(name)
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

  const toggle = () => {
    if (!open) {
      setDraft(name)
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        // fixed anchoring keeps the dialog beside the button and clear
        // of any overflow clipping in the panel
        setPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
      }
    }
    setOpen(!open)
  }

  const pick = (f: File) => {
    void resizeAvatar(f)
      .then((data) => onAvatar(data))
      .catch(() => {})
  }

  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="edit profile"
        aria-expanded={open}
        title="edit name and avatar"
        className="rounded-md p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Pencil className="size-4" aria-hidden />
      </button>
      {open && pos && (
        <div
          role="dialog"
          aria-label="edit profile"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-64 space-y-3 rounded-md border border-border bg-card p-3 shadow-md"
        >
          <div className="flex items-center gap-3">
            <Avatar name={draft || name} avatar={avatar} className="size-12 text-base" />
            <div className="flex flex-col gap-1">
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-md border border-border bg-recessed px-2 py-1 text-xs font-medium text-foreground hover:bg-hover"
              >
                change avatar
              </button>
              {avatar && (
                <button
                  onClick={() => onAvatar('')}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-hover"
                >
                  remove avatar
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label="avatar image"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pick(f)
              e.target.value = ''
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onName(draft)
              setOpen(false)
            }}
            className="flex gap-1.5"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="display name"
              maxLength={24}
              className="min-w-0 flex-1 rounded-md border border-border bg-recessed px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-border bg-recessed px-2 py-1.5 text-xs font-medium text-foreground hover:bg-hover"
            >
              save
            </button>
          </form>
          <button
            onClick={() => {
              onReset()
              setOpen(false)
            }}
            className="w-full rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            reset to join name
          </button>
        </div>
      )}
    </div>
  )
}
