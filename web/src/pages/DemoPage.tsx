// SPDX-License-Identifier: 0BSD
import { useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { DoorOpen } from 'lucide-react'
import Mark from '../components/Mark'
import DemoBadge from '../components/DemoBadge'
import ErrorBoundary from '../components/ErrorBoundary'
import ChatPane from '../room/ChatPane'
import DemoStage from '../room/DemoStage'
import { DemoMesh } from '../lib/demo'
import { SITE } from '../lib/site'
import { useMediaQuery } from '../lib/useMedia'

const DEMO_MAX_FILE = 64 << 20

export default function DemoPage() {
  const asideRef = useRef<HTMLElement>(null)
  const isMd = useMediaQuery('(min-width: 768px)')
  const [chatW, setChatW] = useState(() => {
    const v = Number(localStorage.getItem('qc-chat-w'))
    return v >= 240 && v <= 720 ? v : 320
  })
  useEffect(() => {
    document.title = `demo - ${SITE.name}`
    return () => {
      document.title = SITE.name
    }
  }, [])

  function resizeChat(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = asideRef.current?.getBoundingClientRect().width ?? chatW
    let latest = startW
    const move = (ev: PointerEvent) => {
      latest = Math.min(720, Math.max(240, startW + (startX - ev.clientX)))
      setChatW(latest)
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      localStorage.setItem('qc-chat-w', String(latest))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  return (
    <div className="flex h-full flex-col">
      <DemoBadge />
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-emphasis">
          <Mark size={20} />
          <h1 className="text-sm font-semibold tracking-tight">{SITE.name}</h1>
        </Link>
        <div className="flex-1" />
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <DoorOpen className="size-3.5" />
          leave
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ErrorBoundary variant="panel" label="voice and video">
            <DemoStage />
          </ErrorBoundary>
        </main>
        <aside
          ref={asideRef}
          aria-label="chat"
          style={isMd ? { width: `${chatW}px` } : undefined}
          className="relative flex min-h-0 w-full flex-1 flex-col border-t border-border md:w-auto md:flex-none md:border-l md:border-t-0"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="resize chat panel"
            aria-valuenow={chatW}
            aria-valuemin={240}
            aria-valuemax={720}
            title="drag to resize"
            tabIndex={0}
            onPointerDown={resizeChat}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const delta = e.key === 'ArrowLeft' ? 16 : -16
              setChatW((w) => {
                const next = Math.min(720, Math.max(240, w + delta))
                localStorage.setItem('qc-chat-w', String(next))
                return next
              })
            }}
            className="absolute -left-1.5 bottom-0 top-0 z-10 hidden w-1.5 cursor-col-resize transition-colors hover:bg-hover focus-visible:bg-hover active:bg-hover md:block"
          />
          <ChatPane
            room="demo"
            name="you"
            iceServers={[]}
            maxFileSize={DEMO_MAX_FILE}
            createSession={(o) => new DemoMesh(o)}
          />
        </aside>
      </div>
    </div>
  )
}
