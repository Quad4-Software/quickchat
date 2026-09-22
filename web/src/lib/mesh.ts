import { SignalingSocket, newNonce } from './signal'
import type { SignalData, SignalEvent } from './signal'
import type { FileMeta, Peer } from './types'

// Wire protocol on the 'chat' data channel (json, ordered, reliable).
type Wire =
  | { t: 'chat'; id: string; body?: string; file?: FileMeta; ts: number }
  | { t: 'typing'; on: boolean }

// Wire protocol on 'file-<id>' channels: first frame is json meta, then
// binary chunks, then the sender closes the channel to mark eof.
interface FileHeader extends FileMeta {
  msgId: string
}

export interface ChatEvent {
  id: string
  peer: Peer
  body?: string
  file?: FileMeta
  ts: number
}

export interface FileProgress {
  /** file id from FileMeta */
  fileId: string
  /** owning chat message id */
  msgId: string
  peer: Peer
  dir: 'up' | 'down'
  /** bytes confirmed sent or received so far */
  done: number
  total: number
}

export interface MeshHandlers {
  onWelcome: (self: Peer, peers: Peer[]) => void
  onPeerJoined: (peer: Peer) => void
  onPeerLeft: (peer: Peer) => void
  onChat: (msg: ChatEvent) => void
  onTyping: (peer: Peer, typing: boolean) => void
  onFileProgress: (p: FileProgress) => void
  onFileDone: (fileId: string, msgId: string, peer: Peer, blob: Blob) => void
  onFileError: (fileId: string, msgId: string, peer: Peer, reason: string) => void
  onConnected: (connected: boolean) => void
}

const CHUNK_BYTES = 16 << 10
const HIGH_WATER = 1 << 20
const LOW_WATER = 256 << 10
const MAX_QUEUED_CHAT = 32

interface OutTransfer {
  header: FileHeader
  file: Blob
  offset: number
  channel: RTCDataChannel
  closed: boolean
}

interface InTransfer {
  channel: RTCDataChannel
  header: FileHeader | null
  chunks: Blob[]
  received: number
  failed: boolean
}

interface PeerConn {
  peer: Peer
  pc: RTCPeerConnection
  chat: RTCDataChannel | null
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  chatQueue: string[]
  out: Map<string, OutTransfer>
  in: Map<string, InTransfer>
}

export interface MeshOptions {
  room: string
  name: string
  iceServers: string[]
  maxFileBytes: number
  handlers: MeshHandlers
}

// ChatSession is the transport surface ChatPane needs. Mesh implements
// it over real WebRTC channels; DemoMesh implements it with scripted
// peers so the app can run with no server at all.
export interface ChatSession {
  connect(): void
  close(): void
  broadcastChat(body: string, file?: FileMeta): string
  broadcastTyping(on: boolean): void
  sendFile(file: Blob, meta: FileMeta, msgId: string): void
}

// Mesh maintains a full WebRTC datachannel mesh between room peers. The
// signaling socket only carries presence and sdp or ice payloads. Chat
// and file bytes never touch the server.
export class Mesh implements ChatSession {
  private signal = new SignalingSocket()
  private self: Peer | null = null
  private conns = new Map<string, PeerConn>()
  private opts: MeshOptions
  private h: MeshHandlers

  constructor(opts: MeshOptions) {
    this.opts = opts
    this.h = opts.handlers
    this.signal.onEvent = (e) => this.onSignalEvent(e)
    this.signal.onStateChange = (c) => this.h.onConnected(c)
  }

  connect() {
    this.signal.connect(this.opts.room, this.opts.name)
  }

  peerCount(): number {
    return this.conns.size
  }

  // broadcastChat sends a chat frame on every open chat channel and
  // returns the message id. Frames queue briefly per peer so a message
  // sent while a channel is still opening is not dropped.
  broadcastChat(body: string, file?: FileMeta): string {
    const id = `${this.self?.id ?? 'me'}-${newNonce()}`
    const frame = JSON.stringify({ t: 'chat', id, ts: Date.now(), body, file })
    for (const p of this.conns.values()) this.sendChatFrame(p, frame)
    return id
  }

  broadcastTyping(on: boolean) {
    const frame = JSON.stringify({ t: 'typing', on })
    for (const p of this.conns.values()) this.sendChatFrame(p, frame)
  }

  // sendFile streams a blob to every connected peer on a dedicated
  // channel. The chat message carrying the file meta must be broadcast
  // separately via broadcastChat with the same file id.
  sendFile(file: Blob, meta: FileMeta, msgId: string) {
    for (const p of this.conns.values()) this.startOutTransfer(p, file, meta, msgId)
  }

  close() {
    this.signal.close()
    for (const p of this.conns.values()) this.teardown(p)
    this.conns.clear()
    this.self = null
  }

  // ---- signaling ----

  private onSignalEvent(e: SignalEvent) {
    switch (e.type) {
      case 'welcome': {
        const stale = new Set(this.conns.keys())
        this.self = e.self
        for (const peer of e.peers) {
          stale.delete(peer.id)
          if (!this.conns.has(peer.id)) this.ensureConn(peer, true)
        }
        // peers missing from a fresh roster after reconnect are gone
        for (const id of stale) this.dropPeer(id)
        this.h.onWelcome(e.self, e.peers)
        break
      }
      case 'peer_joined':
        this.ensureConn(e.peer, false)
        this.h.onPeerJoined(e.peer)
        break
      case 'peer_left':
        this.dropPeer(e.peer.id)
        this.h.onPeerLeft(e.peer)
        break
      case 'signal': {
        const p = this.ensureConn(e.from, false)
        void this.handleSignal(p, e.data)
        break
      }
    }
  }

  private ensureConn(peer: Peer, initiator: boolean): PeerConn {
    let p = this.conns.get(peer.id)
    if (p) {
      p.peer = peer // keep the display name fresh
      return p
    }
    const self = this.self?.id ?? ''
    p = {
      peer,
      pc: new RTCPeerConnection(this.rtcConfig()),
      chat: null,
      // deterministic politeness resolves glare for any pair
      polite: self > peer.id,
      makingOffer: false,
      ignoreOffer: false,
      chatQueue: [],
      out: new Map(),
      in: new Map(),
    }
    this.conns.set(peer.id, p)
    this.wirePeerConnection(p)
    if (initiator) {
      // creating the channel triggers onnegotiationneeded, which sends
      // the offer through perfect negotiation
      this.attachChatChannel(p, p.pc.createDataChannel('chat', { ordered: true }))
    }
    return p
  }

  private rtcConfig(): RTCConfiguration {
    const servers = this.opts.iceServers ?? []
    return servers.length > 0 ? { iceServers: [{ urls: servers }] } : {}
  }

  private wirePeerConnection(p: PeerConn) {
    const pc = p.pc
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true
        await pc.setLocalDescription()
        if (pc.localDescription) {
          this.signal.signal(p.peer.id, { desc: pc.localDescription.toJSON() })
        }
      } catch {
        // negotiation errors surface through ice state
      } finally {
        p.makingOffer = false
      }
    }
    pc.onicecandidate = (e) => {
      this.signal.signal(p.peer.id, {
        candidate: e.candidate ? e.candidate.toJSON() : null,
      })
    }
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce()
    }
    pc.ondatachannel = (e) => {
      const ch = e.channel
      if (ch.label === 'chat') {
        this.attachChatChannel(p, ch)
      } else if (ch.label.startsWith('file-')) {
        this.attachInTransfer(p, ch)
      }
    }
  }

  private async handleSignal(p: PeerConn, data: SignalData) {
    const pc = p.pc
    try {
      if (data.desc) {
        const collision =
          data.desc.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable')
        p.ignoreOffer = !p.polite && collision
        if (p.ignoreOffer) return
        await pc.setRemoteDescription(data.desc)
        if (data.desc.type === 'offer') {
          await pc.setLocalDescription()
          if (pc.localDescription) {
            this.signal.signal(p.peer.id, { desc: pc.localDescription.toJSON() })
          }
        }
      } else if (data.candidate !== undefined) {
        try {
          await pc.addIceCandidate(data.candidate ?? undefined)
        } catch (err) {
          if (!p.ignoreOffer) throw err
        }
      }
    } catch {
      // malformed or stale signaling: drop it, the connection retries
    }
  }

  private dropPeer(id: string) {
    const p = this.conns.get(id)
    if (!p) return
    this.conns.delete(id)
    this.teardown(p)
  }

  private teardown(p: PeerConn) {
    for (const t of p.in.values()) {
      t.channel.close()
      if (t.header && !t.failed) {
        this.h.onFileError(t.header.id, t.header.msgId, p.peer, 'peer disconnected')
      }
    }
    for (const t of p.out.values()) {
      if (!t.closed) {
        this.h.onFileProgress({
          fileId: t.header.id,
          msgId: t.header.msgId,
          peer: p.peer,
          dir: 'up',
          done: t.offset,
          total: t.header.size,
        })
      }
      t.channel.close()
    }
    p.in.clear()
    p.out.clear()
    p.chatQueue = []
    p.chat = null
    p.pc.close()
  }

  // ---- chat channel ----

  private attachChatChannel(p: PeerConn, ch: RTCDataChannel) {
    ch.onopen = () => {
      p.chat = ch
      const queued = p.chatQueue
      p.chatQueue = []
      for (const frame of queued) {
        try {
          ch.send(frame)
        } catch {
          break
        }
      }
    }
    ch.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      let w: Wire
      try {
        w = JSON.parse(e.data) as Wire
      } catch {
        return
      }
      this.onWire(p, w)
    }
    ch.onclose = () => {
      if (p.chat === ch) p.chat = null
    }
  }

  private sendChatFrame(p: PeerConn, frame: string) {
    if (p.chat?.readyState === 'open') {
      try {
        p.chat.send(frame)
      } catch {
        // channel closing mid-send: drop it, the peer is likely gone
      }
    } else if (p.chatQueue.length < MAX_QUEUED_CHAT) {
      p.chatQueue.push(frame)
    }
  }

  private onWire(p: PeerConn, w: Wire) {
    if (w.t === 'typing') {
      this.h.onTyping(p.peer, !!w.on)
    } else if (w.t === 'chat' && typeof w.id === 'string' && w.id) {
      const msg: ChatEvent = { id: w.id, peer: p.peer, ts: w.ts || Date.now() }
      if (typeof w.body === 'string' && w.body) msg.body = w.body.slice(0, 4096)
      if (w.file && typeof w.file === 'object') {
        const f = w.file
        if (
          typeof f.id === 'string' &&
          typeof f.name === 'string' &&
          typeof f.size === 'number' &&
          f.size > 0 &&
          f.size <= this.opts.maxFileBytes
        ) {
          msg.file = {
            id: f.id,
            name: f.name.slice(0, 255),
            size: f.size,
            mime: String(f.mime ?? ''),
          }
        }
      }
      this.h.onChat(msg)
    }
  }

  // ---- file transfer ----

  private startOutTransfer(p: PeerConn, file: Blob, meta: FileMeta, msgId: string) {
    if (file.size > this.opts.maxFileBytes) return
    let ch: RTCDataChannel
    try {
      ch = p.pc.createDataChannel(`file-${meta.id}`, { ordered: true })
    } catch {
      return
    }
    ch.binaryType = 'arraybuffer'
    ch.bufferedAmountLowThreshold = LOW_WATER
    const t: OutTransfer = {
      header: { ...meta, msgId },
      file,
      offset: 0,
      channel: ch,
      closed: false,
    }
    p.out.set(meta.id, t)
    ch.onopen = () => {
      try {
        ch.send(JSON.stringify(t.header))
      } catch {
        return
      }
      this.pumpOut(p, t)
    }
    ch.onbufferedamountlow = () => this.pumpOut(p, t)
    ch.onclose = () => {
      t.closed = true
      p.out.delete(meta.id)
    }
  }

  private pumpOut(p: PeerConn, t: OutTransfer) {
    const ch = t.channel
    while (t.offset < t.file.size) {
      if (ch.bufferedAmount >= HIGH_WATER) return // wait for drain
      const end = Math.min(t.offset + CHUNK_BYTES, t.file.size)
      const slice = t.file.slice(t.offset, end)
      try {
        ch.send(slice)
      } catch {
        return
      }
      t.offset = end
      this.h.onFileProgress({
        fileId: t.header.id,
        msgId: t.header.msgId,
        peer: p.peer,
        dir: 'up',
        done: t.offset,
        total: t.header.size,
      })
    }
    if (t.offset >= t.file.size) {
      // close after the buffer drains so the last chunk is delivered
      const wait = () => {
        if (ch.readyState !== 'open') return
        if (ch.bufferedAmount === 0) {
          ch.close()
        } else {
          window.setTimeout(wait, 25)
        }
      }
      window.setTimeout(wait, 25)
    }
  }

  private attachInTransfer(p: PeerConn, ch: RTCDataChannel) {
    const fileId = ch.label.slice('file-'.length)
    const t: InTransfer = {
      channel: ch,
      header: null,
      chunks: [],
      received: 0,
      failed: false,
    }
    p.in.set(fileId, t)
    ch.binaryType = 'arraybuffer'
    ch.onmessage = (e) => {
      if (t.header === null) {
        if (typeof e.data !== 'string') {
          this.failIn(p, t, 'bad header')
          return
        }
        try {
          t.header = JSON.parse(e.data) as FileHeader
        } catch {
          this.failIn(p, t, 'bad header')
          return
        }
        if (
          typeof t.header.size !== 'number' ||
          t.header.size <= 0 ||
          t.header.size > this.opts.maxFileBytes ||
          typeof t.header.id !== 'string'
        ) {
          this.failIn(p, t, 'file too large')
        }
        return
      }
      if (typeof e.data === 'string' || !(e.data instanceof ArrayBuffer)) return
      t.received += e.data.byteLength
      if (t.received > t.header.size) {
        this.failIn(p, t, 'size mismatch')
        return
      }
      t.chunks.push(new Blob([e.data]))
      this.h.onFileProgress({
        fileId: t.header.id,
        msgId: t.header.msgId,
        peer: p.peer,
        dir: 'down',
        done: t.received,
        total: t.header.size,
      })
    }
    ch.onclose = () => {
      p.in.delete(fileId)
      if (t.failed || !t.header) return
      if (t.received !== t.header.size) {
        this.h.onFileError(t.header.id, t.header.msgId, p.peer, 'transfer truncated')
        return
      }
      const blob = new Blob(t.chunks, {
        type: t.header.mime || 'application/octet-stream',
      })
      t.chunks = []
      this.h.onFileDone(t.header.id, t.header.msgId, p.peer, blob)
    }
  }

  private failIn(p: PeerConn, t: InTransfer, reason: string) {
    if (t.failed) return
    t.failed = true
    t.chunks = []
    try {
      t.channel.close()
    } catch {
      // already closing
    }
    if (t.header) this.h.onFileError(t.header.id, t.header.msgId, p.peer, reason)
  }
}

export { newNonce }
