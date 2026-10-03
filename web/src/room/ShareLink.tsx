import { useEffect, useRef, useState } from 'react'
import { Copy, QrCode, Share2 } from 'lucide-react'
import { renderSVG } from 'uqr'

// ShareLink shows the room link as a qr code so a second device can
// join by camera, plus the native share sheet when the os offers one
export default function ShareLink({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
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
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // fixed positioning escapes overflow-hidden ancestors that would
      // clip an absolute popover, the header sits at the top so the
      // dialog drops below it
      setPos({
        top: r.bottom + 8,
        right: window.innerWidth - r.right,
      })
    }
    setOpen(!open)
  }

  const native = typeof navigator.share === 'function'
  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="share room"
        aria-expanded={open}
        title="share room"
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Share2 className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">share</span>
      </button>
      {open && pos && (
        <div
          role="dialog"
          aria-label="room qr code"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-56 rounded-md border border-border bg-card p-3 shadow-md"
        >
          <div
            className="mx-auto rounded-md bg-white p-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: renderSVG(url) }}
          />
          <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-[10px] text-dim">
            <QrCode className="size-3" aria-hidden />
            scan to join
          </p>
          <div className="flex gap-1.5 pt-2">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(url).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-recessed px-2 py-1.5 text-xs font-medium text-foreground hover:bg-hover"
            >
              <Copy className="size-3.5" aria-hidden />
              {copied ? 'copied' : 'copy link'}
            </button>
            {native && (
              <button
                onClick={() => {
                  void navigator.share({ title: 'quickchat room', url }).catch(() => {})
                  setOpen(false)
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-recessed px-2 py-1.5 text-xs font-medium text-foreground hover:bg-hover"
              >
                <Share2 className="size-3.5" aria-hidden />
                share
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
