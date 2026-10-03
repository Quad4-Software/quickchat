import { useEffect, useRef, useState } from 'react'
import { QrCode, Share2 } from 'lucide-react'
import { renderSVG } from 'uqr'

// ShareLink offers the native share sheet when available, plus a qr
// code so a phone can jump into the room by camera
export default function ShareLink({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
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

  const native = typeof navigator.share === 'function'
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          if (native) {
            void navigator.share({ title: 'quickchat room', url }).catch(() => {})
          } else {
            setOpen(!open)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
        aria-label="share room"
        aria-expanded={native ? undefined : open}
        title={native ? 'share room' : 'share or scan the qr code'}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Share2 className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">share</span>
      </button>
      {!native && open && (
        <div
          role="dialog"
          aria-label="room qr code"
          className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-md border border-border bg-card p-3 shadow-md"
        >
          <div
            className="mx-auto w-fit rounded-md bg-white p-2 [&>svg]:block"
            // uqr emits svg markup for the room url
            dangerouslySetInnerHTML={{ __html: renderSVG(url) }}
          />
          <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-[10px] text-dim">
            <QrCode className="size-3" aria-hidden />
            scan to join
          </p>
        </div>
      )}
    </div>
  )
}
