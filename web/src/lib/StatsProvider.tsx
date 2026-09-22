// SPDX-License-Identifier: 0BSD
import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { StatsContext } from './stats'
import type { StatCollector, StatsRegistry } from './stats'

export default function StatsProvider({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, StatCollector>())
  const registry = useMemo<StatsRegistry>(
    () => ({
      register(key, fn) {
        map.current.set(key, fn)
        return () => {
          if (map.current.get(key) === fn) map.current.delete(key)
        }
      },
      collectors: () => map.current,
    }),
    [],
  )
  return <StatsContext.Provider value={registry}>{children}</StatsContext.Provider>
}
