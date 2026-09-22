import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { Check, Copy, Dices, DoorOpen, Lock } from 'lucide-react'
import Mark from '../components/Mark'
import ChatPane from '../room/ChatPane'
import { getRoom, livekitToken } from '../lib/api'
import { keyFromHash } from '../lib/e2ee'
import { randomName } from '../lib/names'
import { SITE } from '../lib/site'
import type { LiveKitGrant, RoomInfo } from '../lib/types'

const Stage = lazy(() => import('../room/Stage'))

export default function RoomPage({ id }: { id: string }) {
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)
  const [grant, setGrant] = useState<LiveKitGrant | null>(null)
  const [copied, setCopied] = useState(false)
  // read once at mount: the fragment carries the shared media key and is
  // stable for the lifetime of the page
  const [e2eeKey] = useState(() => keyFromHash(location.hash))
  const copyTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  useEffect(() => {
    document.title = `${id} - ${SITE.name}`
    return () => {
      document.title = SITE.name
    }
  }, [id])

  useEffect(() => {
    getRoom(id)
      .then(setInfo)
      .catch(() => setError('room not found'))
  }, [id])

  async function join(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    if (info?.livekit) {
      try {
        setGrant(await livekitToken(id, n))
      } catch {
        // chat still works without av
      }
    }
    setJoined(true)
  }

  function copyLink() {
    navigator.clipboard.writeText(location.href).then(() => {
      setCopied(true)
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
    })
  }

  if (error) {
    return (
      <main id="main" className="flex h-full flex-col items-center justify-center gap-4">
        <Mark size={40} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link
          href="/"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
        >
          home
        </Link>
      </main>
    )
  }

  if (!joined) {
    return (
      <main id="main" className="flex h-full items-center justify-center px-4">
        <form
          onSubmit={join}
          className="w-full max-w-xs rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex items-center gap-2 pb-4">
            <Mark size={20} className="text-emphasis" />
            <span className="font-mono text-xs text-muted-foreground">{id}</span>
          </div>
          <label htmlFor="name" className="pb-1.5 block text-sm text-muted-foreground">
            display name
          </label>
          <div className="flex gap-2">
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="anon"
              maxLength={32}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-border bg-recessed px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="button"
              onClick={() => setName(randomName())}
              aria-label="random name"
              title="random name"
              className="shrink-0 rounded-md border border-border bg-card px-3 py-2 text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <Dices className="size-4" />
            </button>
          </div>
          <button
            type="submit"
            className="mt-3 w-full rounded-md bg-inverted px-3 py-2 text-sm font-semibold text-inverted-foreground shadow-sm hover:opacity-90"
          >
            join room
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-emphasis">
          <Mark size={20} />
          <span className="text-sm font-semibold tracking-tight">{SITE.name}</span>
        </Link>
        <h1 className="font-mono text-xs font-normal text-muted-foreground">{id}</h1>
        {e2eeKey && (
          <span
            className="flex items-center gap-1 font-mono text-[10px] text-success"
            title="media encryption key is shared through the link fragment"
          >
            <Lock className="size-3" aria-hidden />
            e2ee
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? 'copied' : 'copy link'}
        </button>
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
          {grant ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center p-6">
                  <p className="text-sm text-muted-foreground">connecting to voice...</p>
                </div>
              }
            >
              <Stage grant={grant} e2eeKey={e2eeKey} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-sm text-muted-foreground">
                {info?.livekit
                  ? 'connecting to voice...'
                  : 'voice and video unavailable on this server'}
              </p>
            </div>
          )}
        </main>
        <aside
          aria-label="chat"
          className="flex min-h-0 w-full flex-1 flex-col border-t border-border md:w-80 md:flex-none md:border-l md:border-t-0"
        >
          <ChatPane room={id} name={name.trim() || 'anon'} />
        </aside>
      </div>
    </div>
  )
}
