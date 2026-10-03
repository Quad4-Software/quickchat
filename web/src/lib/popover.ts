// SPDX-License-Identifier: 0BSD
// anchor computes a fixed-position style that keeps a popup attached
// to its trigger, flipping below the button when there is no room
// above it (the mobile stage strip sits at the top of the screen) and
// left-aligning for triggers near the left edge
export function anchor(
  btn: HTMLElement,
  estHeight = 300,
  side: 'left' | 'right' = 'right',
):
  | { top: number; left?: number; right?: number }
  | { bottom: number; left?: number; right?: number } {
  const r = btn.getBoundingClientRect()
  const h = side === 'left' ? { left: r.left } : { right: window.innerWidth - r.right }
  if (r.top > estHeight + 16) {
    return { bottom: window.innerHeight - r.top + 8, ...h }
  }
  return { top: r.bottom + 8, ...h }
}
