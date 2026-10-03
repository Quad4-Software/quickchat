// SPDX-License-Identifier: 0BSD
import { useEffect, useState } from 'react'

// how far the visual viewport must shrink before we treat it as an
// on-screen keyboard rather than a pinch zoom or url bar animation
const KEYBOARD_SHRINK_PX = 120

export interface ViewportBox {
  /** height of the visible region in css px */
  height: number
  /** how far the visible region is scrolled below the layout top */
  offsetTop: number
}

// useVisualViewport tracks window.visualViewport while it is
// significantly smaller than the layout viewport. On ios the keyboard
// shrinks the visual viewport without touching 100dvh, so the room
// shell uses this box to stay on screen. Returns null when the layout
// fills the viewport normally.
export function useVisualViewport(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      if (vv.height < window.innerHeight - KEYBOARD_SHRINK_PX) {
        setBox({ height: vv.height, offsetTop: vv.offsetTop })
      } else {
        setBox(null)
      }
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return box
}
