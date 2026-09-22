// SPDX-License-Identifier: 0BSD
import { useEffect, useState } from 'react'
import { Activity, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { useStatsCollectors } from '../lib/stats'
import type { StatRow, StatSection } from '../lib/stats'

const toneClass = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
}

function Rows({ rows }: { rows: StatRow[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="truncate text-muted-foreground">{r.label}</dt>
          <dd
            className={cn(
              'text-right font-mono text-foreground',
              r.tone && toneClass[r.tone],
            )}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// debug overlay polls every registered collector and renders their rows.
// collectors live next to the transports they describe (livekit stage,
// p2p mesh) so the panel itself stays transport agnostic.
export default function DebugPanel({ onClose }: { onClose: () => void }) {
  const collectors = useStatsCollectors()
  const [sections, setSections] = useState<StatSection[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const out: StatSection[] = []
      for (const fn of collectors().values()) {
        try {
          const s = await fn()
          if (s) out.push(s)
        } catch {
          // a collector that throws gets skipped this round
        }
      }
      if (alive) setSections(out)
    }
    void tick()
    const id = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [collectors])

  return (
    <div
      role="complementary"
      aria-label="connection debug"
      className="absolute inset-y-0 right-0 z-20 flex w-72 flex-col border-l border-border bg-card/95 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Activity className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-xs font-semibold text-foreground">connection</h2>
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="close debug panel"
          className="rounded-md p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
        {sections.length === 0 && (
          <p className="text-muted-foreground">collecting stats...</p>
        )}
        {sections.map((s) => (
          <section key={s.title} className="space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-dim">
              {s.title}
            </h3>
            <Rows rows={s.rows} />
            {s.groups?.map((g) => (
              <div key={g.heading} className="space-y-1 pt-1">
                <h4 className="text-[11px] font-medium text-muted-foreground">
                  {g.heading}
                </h4>
                <Rows rows={g.rows} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
