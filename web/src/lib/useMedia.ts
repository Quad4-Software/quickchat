// SPDX-License-Identifier: 0BSD
import { useSyncExternalStore } from 'react'

// reactive media query hook; false during ssr and first paint
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}
