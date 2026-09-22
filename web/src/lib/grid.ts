// SPDX-License-Identifier: 0BSD

// Tile aspect for the video grid: 16:9 matches camera and screen share
// content and keeps letterboxing predictable.
export const TILE_ASPECT = 16 / 9

export interface GridLayout {
  cols: number
  tileW: number
  tileH: number
}

// gridLayout picks the column count that maximizes tile area while
// keeping every tile inside width x height with no scrolling. This is
// the standard video grid approach used by meet and jitsi: tiles shrink
// to fit rather than overflow the stage.
export function gridLayout(
  count: number,
  width: number,
  height: number,
  gap = 12,
): GridLayout {
  if (count <= 0 || width <= 0 || height <= 0) return { cols: 1, tileW: 0, tileH: 0 }
  let best: GridLayout = { cols: 1, tileW: 0, tileH: 0 }
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const tileW = Math.min(
      (width - gap * (cols - 1)) / cols,
      ((height - gap * (rows - 1)) / rows) * TILE_ASPECT,
    )
    if (tileW > best.tileW) {
      best = { cols, tileW, tileH: tileW / TILE_ASPECT }
    }
  }
  return best
}
