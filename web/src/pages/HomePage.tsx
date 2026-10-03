import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowRight, ChevronDown, Plus } from 'lucide-react'
import Mark from '../components/Mark'
import Starfield from '../components/Starfield'
import { createRoom } from '../lib/api'
import { chooseServer, isDesktop } from '../lib/desktop'
import { generateKey } from '../lib/e2ee'
import { SITE } from '../lib/site'

export default function HomePage() {
  const [, navigate] = useLocation()
  const [join, setJoin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adv, setAdv] = useState(false)
  const [server, setServer] = useState('')

  async function onCreate() {
    setBusy(true)
    setError('')
    try {
      const { id } = await createRoom()
      navigate(`/r/${id}#e2ee=${generateKey()}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not create room')
      setBusy(false)
    }
  }

  function onJoin(e: React.FormEvent) {
    e.preventDefault()
    // accept a bare id or a pasted room url, keeping any e2ee fragment
    const v = join.trim()
    const hash = v.includes('#') ? v.slice(v.indexOf('#')) : ''
    const id = v.split('#')[0].split('/').filter(Boolean).pop() ?? ''
    if (id) navigate(`/r/${id}${hash}`)
  }

  return (
    <main
      id="main"
      className="relative flex h-full items-center justify-center overflow-y-auto px-4"
    >
      <Starfield />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 pb-8">
          <Mark size={48} className="text-emphasis" />
          <h1 className="text-xl font-semibold tracking-tight text-emphasis">
            {SITE.name}
          </h1>
          <p className="text-sm text-muted-foreground">{SITE.tagline}</p>
        </div>

        <div className="rounded-lg border border-border bg-card shadow-sm">
          <div className="px-4 py-4">
            <button
              onClick={onCreate}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-inverted px-3 py-2 text-sm font-semibold text-inverted-foreground shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" />
              {busy ? 'creating...' : 'new room'}
            </button>
          </div>

          <div className="border-t border-border px-4 py-4">
            <form onSubmit={onJoin} className="flex gap-2">
              <input
                value={join}
                onChange={(e) => setJoin(e.target.value)}
                placeholder="room link or id"
                className="min-w-0 flex-1 rounded-md border border-border bg-recessed px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="submit"
                aria-label="join room"
                className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <ArrowRight className="size-4" />
              </button>
            </form>
            {error && <p className="pt-2 text-sm text-destructive">{error}</p>}
          </div>

          <div className="border-t border-border px-4">
            <button
              type="button"
              onClick={() => {
                setServer((s) => s || location.origin)
                setAdv(!adv)
              }}
              aria-expanded={adv}
              className="flex w-full items-center justify-between py-3 text-xs text-muted-foreground hover:text-foreground"
            >
              advanced
              <ChevronDown
                className={`size-3.5 transition-transform duration-200 ${adv ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${adv ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="min-h-0 overflow-hidden">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const url = chooseServer(server)
                    if (!url) setError('invalid server address')
                    else if (url !== 'local') location.href = url
                  }}
                  className="flex gap-2 pb-3"
                >
                  <input
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder={location.origin}
                    aria-label="server address"
                    className="min-w-0 flex-1 rounded-md border border-border bg-recessed px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
                  >
                    connect
                  </button>
                </form>
                {isDesktop() && (
                  <button
                    type="button"
                    onClick={() => chooseServer('local')}
                    className="pb-4 text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    host rooms locally on this device
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="pt-4 text-center">
          <Link
            href="/demo"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            try the demo
          </Link>
        </p>
        <p className="pt-4 text-center font-mono text-xs text-dim">{SITE.footer}</p>
      </div>
    </main>
  )
}
