// SPDX-License-Identifier: 0BSD
// Markdown-lite for chat bodies: fenced code, inline code, bold,
// italic, and bare URLs. Deliberately flat with no nesting so hostile
// input can never produce unexpected markup.
export type MdNode =
  | { k: 'text'; s: string }
  | { k: 'bold'; s: string }
  | { k: 'ital'; s: string }
  | { k: 'code'; s: string }
  | { k: 'pre'; s: string }
  | { k: 'link'; s: string; href: string }

const FENCE = /```([\s\S]*?)```/g
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(https?:\/\/[^\s<>"')]+)/g

// parseMd tokenizes a chat body into a flat node list. Fences split
// the body first, then inline tokens run inside each text segment.
export function parseMd(body: string): MdNode[] {
  const out: MdNode[] = []
  let last = 0
  FENCE.lastIndex = 0
  for (let m = FENCE.exec(body); m; m = FENCE.exec(body)) {
    if (m.index > last) out.push(...parseInline(body.slice(last, m.index)))
    const inner = m[1].replace(/^\n|\n$/g, '')
    if (inner) out.push({ k: 'pre', s: inner })
    last = m.index + m[0].length
  }
  if (last < body.length) out.push(...parseInline(body.slice(last)))
  return out
}

function parseInline(s: string): MdNode[] {
  const out: MdNode[] = []
  let last = 0
  INLINE.lastIndex = 0
  for (let m = INLINE.exec(s); m; m = INLINE.exec(s)) {
    if (m.index > last) out.push({ k: 'text', s: s.slice(last, m.index) })
    const [raw, code, bold, ital, link] = m
    if (code) out.push({ k: 'code', s: raw.slice(1, -1) })
    else if (bold) out.push({ k: 'bold', s: raw.slice(2, -2) })
    else if (ital) out.push({ k: 'ital', s: raw.slice(1, -1) })
    else if (link) out.push({ k: 'link', s: raw, href: raw })
    last = m.index + raw.length
  }
  if (last < s.length) out.push({ k: 'text', s: s.slice(last) })
  return out
}
