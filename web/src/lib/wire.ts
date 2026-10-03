// SPDX-License-Identifier: 0BSD
// Shared wire-frame validation for chat transports. Both the p2p mesh
// and the livekit data channel carry the same json frames; this
// parses and dispatches them so the two stay in lockstep.

import type { ChatEvent, MeshHandlers } from './mesh'
import type { Peer } from './types'

export interface Wire {
  t: string
  id?: string
  on?: boolean
  emoji?: string
  name?: string
  data?: string
  body?: string
  ts?: number
  reply?: { id?: string; name?: string; body?: string; file?: string }
  file?: { id?: string; name?: string; size?: number; mime?: string }
}

// routeWire validates a decoded frame and calls the matching handler.
// It mutates the peer for rename and avatar so subsequent frames from
// the same source carry fresh identity.
export function routeWire(h: MeshHandlers, peer: Peer, w: Wire, maxFileBytes: number) {
  if (w.t === 'typing') {
    h.onTyping(peer, !!w.on)
  } else if (w.t === 'delete' && typeof w.id === 'string' && w.id) {
    h.onDelete(peer, w.id)
  } else if (w.t === 'present' && typeof w.id === 'string' && w.id) {
    h.onPresent(peer, w.id, !!w.on)
  } else if (w.t === 'sound' && typeof w.name === 'string' && w.name) {
    h.onSound(peer, w.name.slice(0, 64))
  } else if (w.t === 'rename' && typeof w.name === 'string' && w.name) {
    peer.name = w.name.slice(0, 64)
    h.onRename(peer, peer.name)
  } else if (
    w.t === 'avatar' &&
    typeof w.data === 'string' &&
    (w.data === '' || (w.data.startsWith('data:image/') && w.data.length < 40_000))
  ) {
    if (w.data) peer.avatar = w.data
    else delete peer.avatar
    h.onAvatar(peer, w.data)
  } else if (
    w.t === 'react' &&
    typeof w.id === 'string' &&
    w.id &&
    typeof w.emoji === 'string' &&
    w.emoji &&
    w.emoji.length <= 8
  ) {
    h.onReact(peer, w.id, w.emoji, !!w.on)
  } else if (w.t === 'chat' && typeof w.id === 'string' && w.id) {
    const msg: ChatEvent = { id: w.id, peer, ts: w.ts || Date.now() }
    if (typeof w.body === 'string' && w.body) msg.body = w.body.slice(0, 4096)
    if (w.reply && typeof w.reply === 'object') {
      const r = w.reply
      if (typeof r.id === 'string' && r.id && typeof r.name === 'string') {
        msg.reply = {
          id: r.id,
          name: r.name.slice(0, 64),
          ...(typeof r.body === 'string' && r.body ? { body: r.body.slice(0, 200) } : {}),
          ...(typeof r.file === 'string' && r.file ? { file: r.file.slice(0, 255) } : {}),
        }
      }
    }
    if (w.file && typeof w.file === 'object') {
      const f = w.file
      if (
        typeof f.id === 'string' &&
        typeof f.name === 'string' &&
        typeof f.size === 'number' &&
        f.size > 0 &&
        f.size <= maxFileBytes
      ) {
        msg.file = {
          id: f.id,
          name: f.name.slice(0, 255),
          size: f.size,
          mime: String(f.mime ?? ''),
        }
      }
    }
    h.onChat(msg)
  }
}
