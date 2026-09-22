// SPDX-License-Identifier: 0BSD
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

// stats registry: providers register an async collector keyed by section
// name and the debug panel polls all of them while open. Keeps media and
// p2p transports decoupled from the panel itself.
export interface StatRow {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'bad'
}

export interface StatSection {
  title: string
  rows: StatRow[]
  groups?: { heading: string; rows: StatRow[] }[]
}

export type StatCollector = () => Promise<StatSection | null> | StatSection | null

export interface StatsRegistry {
  register(key: string, fn: StatCollector): () => void
  collectors(): Map<string, StatCollector>
}

export const StatsContext = createContext<StatsRegistry | null>(null)

export function useRegisterStats(key: string, fn: StatCollector) {
  const registry = useContext(StatsContext)
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    if (!registry) return
    return registry.register(key, () => ref.current())
  }, [registry, key])
}

export function useStatsCollectors(): () => Map<string, StatCollector> {
  const registry = useContext(StatsContext)
  return useCallback(() => registry?.collectors() ?? new Map(), [registry])
}
