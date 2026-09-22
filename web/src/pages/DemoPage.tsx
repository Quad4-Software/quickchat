// SPDX-License-Identifier: 0BSD
import { useEffect } from 'react'
import { Link } from 'wouter'
import { DoorOpen, MicOff, VideoOff } from 'lucide-react'
import Mark from '../components/Mark'
import DemoBadge from '../components/DemoBadge'
import ChatPane from '../room/ChatPane'
import { DemoMesh } from '../lib/demo'
import { SITE } from '../lib/site'

const DEMO_MAX_FILE = 64 << 20

export default function DemoPage() {
  useEffect(() => {
    document.title = `demo - ${SITE.name}`
    return () => {
      document.title = SITE.name
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <DemoBadge />
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-emphasis">
          <Mark size={20} />
          <span className="text-sm font-semibold tracking-tight">{SITE.name}</span>
        </Link>
        <h1 className="font-mono text-xs font-normal text-muted-foreground">demo</h1>
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
        <main id="main" className="min-h-0 min-w-0 flex-1">
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <div className="flex gap-2 text-muted-foreground">
              <MicOff className="size-5" aria-hidden />
              <VideoOff className="size-5" aria-hidden />
            </div>
            <p className="max-w-xs text-center text-sm text-muted-foreground">
              scripted peers are chatting in the panel. send a message or drop a file to
              try the p2p flow.
            </p>
          </div>
        </main>
        <aside
          aria-label="chat"
          className="flex min-h-0 w-full flex-1 flex-col border-t border-border md:w-80 md:flex-none md:border-l md:border-t-0"
        >
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
