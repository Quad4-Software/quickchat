// SPDX-License-Identifier: 0BSD
// DemoMesh is a fake ChatSession that plays a scripted room so the app
// can be tried with no server at all. It emits welcome, presence, chat,
// typing, and a file transfer the same way a real WebRTC peer would.
import type { ChatSession, MeshOptions, MeshHandlers } from './mesh'
import { newNonce } from './mesh'
import type { FileMeta, Peer } from './types'

const CONNECT_MS = 350
const REPLY_TYPING_MS = 900
const REPLY_BASE_MS = 1400
const REPLY_JITTER_MS = 1800
const AMBIENT_MS = 28000

const PEERS: Peer[] = [
  { id: 'demo-nova', name: 'nova' },
  { id: 'demo-rex', name: 'rex' },
]

// seed script: believable first screen for a fresh visitor
const SCRIPT: { peer: number; body: string; delay: number; typing?: number }[] = [
  { peer: 0, body: 'hey, welcome in', delay: 900 },
  {
    peer: 1,
    body: 'this room is fully peer to peer, nothing hits the server',
    delay: 2200,
    typing: 900,
  },
  { peer: 0, body: 'drag a file in, it goes straight to us', delay: 3400 },
]

const REPLIES = [
  'nice, try sending a file too',
  'yep, it all rides on webrtc data channels',
  'the server only sees signaling and presence',
  'share the link and the e2ee key travels in the fragment',
  'grab the api docs at /docs if you want a native client',
]

function replyDelay() {
  return REPLY_BASE_MS + Math.random() * REPLY_JITTER_MS
}

// demoImage draws a small png in memory so the seeded attachment shows
// the real image preview path instead of a stub
function demoImage(): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = 480
  c.height = 300
  const ctx = c.getContext('2d')
  if (!ctx) return Promise.resolve(new Blob(['quad4'], { type: 'text/plain' }))
  ctx.fillStyle = '#09090b'
  ctx.fillRect(0, 0, c.width, c.height)
  const g = ctx.createRadialGradient(240, 150, 20, 240, 150, 220)
  g.addColorStop(0, '#27272a')
  g.addColorStop(1, '#09090b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#fafafa'
  ctx.font = '600 28px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('quad4 // quickchat', 240, 140)
  ctx.fillStyle = '#a1a1aa'
  ctx.font = '16px monospace'
  ctx.fillText('p2p file transfer, rendered in memory', 240, 175)
  return new Promise((resolve) => {
    c.toBlob(
      (b) => resolve(b ?? new Blob(['quad4'], { type: 'text/plain' })),
      'image/png',
    )
  })
}

export class DemoMesh implements ChatSession {
  private h: MeshHandlers
  private self: Peer
  private timers: number[] = []
  private replyIdx = 0

  constructor(opts: MeshOptions) {
    this.h = opts.handlers
    this.self = { id: 'demo-you', name: opts.name }
  }

  private after(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms))
  }

  connect() {
    this.after(CONNECT_MS, () => {
      this.h.onConnected(true)
      this.h.onWelcome(this.self, [...PEERS])
      this.playScript()
      this.ambient()
    })
  }

  private playScript() {
    let at = 0
    for (const s of SCRIPT) {
      const peer = PEERS[s.peer]
      if (s.typing) {
        this.after(at + s.delay - s.typing, () => this.h.onTyping(peer, true))
      }
      this.after(at + s.delay, () => {
        this.h.onTyping(peer, false)
        this.h.onChat({ id: `demo-${newNonce()}`, peer, ts: Date.now(), body: s.body })
      })
      at += s.delay
    }
    // rex sends an image so previews and blob handling are exercised
    this.after(at + 1200, () => void this.seedFile(PEERS[1]))
  }

  private async seedFile(peer: Peer) {
    const blob = await demoImage()
    const msgId = `demo-${newNonce()}`
    const fileId = newNonce()
    const meta = {
      id: fileId,
      name: 'quickchat.png',
      size: blob.size,
      mime: blob.type || 'image/png',
    }
    this.h.onChat({ id: msgId, peer, ts: Date.now(), file: meta })
    // a couple of progress ticks so the download state is visible
    this.h.onFileProgress({
      dir: 'down',
      fileId,
      peer,
      msgId,
      done: Math.floor(blob.size / 2),
      total: blob.size,
    })
    this.after(600, () => {
      this.h.onFileProgress({
        dir: 'down',
        fileId,
        peer,
        msgId,
        done: blob.size,
        total: blob.size,
      })
      this.h.onFileDone(fileId, msgId, peer, blob)
    })
  }

  private ambient() {
    const tick = () => {
      const peer = PEERS[Math.floor(Math.random() * PEERS.length)]
      const body = REPLIES[Math.floor(Math.random() * REPLIES.length)]
      this.h.onTyping(peer, true)
      this.after(1200, () => {
        this.h.onTyping(peer, false)
        this.h.onChat({ id: `demo-${newNonce()}`, peer, ts: Date.now(), body })
      })
      this.timers.push(window.setTimeout(tick, AMBIENT_MS))
    }
    this.timers.push(window.setTimeout(tick, AMBIENT_MS))
  }

  broadcastChat(body: string, file?: FileMeta): string {
    void file
    const id = `${this.self.id}-${newNonce()}`
    const peer = PEERS[this.replyIdx % PEERS.length]
    const reply = REPLIES[this.replyIdx++ % REPLIES.length]
    this.after(REPLY_TYPING_MS, () => this.h.onTyping(peer, true))
    this.after(replyDelay(), () => {
      this.h.onTyping(peer, false)
      this.h.onChat({ id: `demo-${newNonce()}`, peer, ts: Date.now(), body: reply })
    })
    void body
    return id
  }

  broadcastTyping(on: boolean) {
    // echo typing back occasionally so the indicator shows both ways
    if (on && Math.random() < 0.4) {
      const peer = PEERS[Math.floor(Math.random() * PEERS.length)]
      this.after(700, () => this.h.onTyping(peer, true))
      this.after(2400, () => this.h.onTyping(peer, false))
    }
  }

  sendFile(file: Blob, meta: FileMeta, msgId: string) {
    // simulate fast p2p delivery progress to every peer, then ack
    for (const peer of PEERS) {
      let sent = 0
      const step = () => {
        sent = Math.min(file.size, sent + Math.ceil(file.size / 3))
        this.h.onFileProgress({
          dir: 'up',
          fileId: meta.id,
          peer,
          msgId,
          done: sent,
          total: file.size,
        })
        if (sent < file.size) this.after(150, step)
      }
      step()
    }
    this.after(REPLY_TYPING_MS + 900, () => {
      const peer = PEERS[0]
      this.h.onChat({
        id: `demo-${newNonce()}`,
        peer,
        ts: Date.now(),
        body: 'got it, came through clean',
      })
    })
  }

  close() {
    for (const t of this.timers) window.clearTimeout(t)
    this.timers = []
    this.h.onConnected(false)
  }
}
