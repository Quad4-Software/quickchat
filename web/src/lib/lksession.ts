// SPDX-License-Identifier: 0BSD
// ChatSession over the livekit room data channel. The sfu path works
// everywhere the voice connection does, so chat and files ride it when
// a livekit grant exists instead of relying on direct p2p links that
// some nat and browser combinations cannot establish.

import type { Participant, RemoteParticipant, Room } from 'livekit-client'
import { ConnectionState, RoomEvent } from 'livekit-client'
import { routeWire } from './wire'
import { newNonce } from './signal'
import type { SignalState } from './signal'
import type { ChatSession, MeshHandlers, MeshOptions } from './mesh'
import type { FileMeta, Peer } from './types'

const TOPIC = 'q'
// livekit data packets are capped well under 64k, keep chunks small
const LK_CHUNK = 12 << 10
// binary chunk frame: [0x46][u16be id len][id utf8][u32be seq][payload]
const CHUNK_TAG = 0x46

const enc = new TextEncoder()
const dec = new TextDecoder()

interface InFile {
  header: { id: string; msgId: string; name: string; size: number; mime: string }
  peer: Peer
  chunks: (Blob | undefined)[]
  received: number
}

function toPeer(p: Participant): Peer {
  return { id: p.identity, name: p.name || p.identity }
}

export class LkSession implements ChatSession {
  private h: MeshHandlers
  private self?: Peer
  private peers = new Map<string, Peer>()
  private files = new Map<string, InFile>()
  private closed = false
  private welcomed = false

  constructor(
    private room: Room,
    private opts: MeshOptions,
  ) {
    this.h = opts.handlers
  }

  connect() {
    this.closed = false
    const room = this.room

    room.on(RoomEvent.DataReceived, this.onData)
    room.on(RoomEvent.ParticipantConnected, this.onJoined)
    room.on(RoomEvent.ParticipantDisconnected, this.onLeft)
    room.on(RoomEvent.ConnectionStateChanged, this.onState)

    if (room.state === ConnectionState.Connected) this.welcome()
  }

  private welcome = () => {
    if (this.welcomed) return
    this.welcomed = true
    const room = this.room
    this.self = toPeer(room.localParticipant)
    for (const p of room.remoteParticipants.values()) {
      this.peers.set(p.identity, toPeer(p))
    }
    this.h.onWelcome(this.self, [...this.peers.values()])
    for (const peer of this.peers.values()) this.h.onPeerLink(peer, 'open')
  }

  private onJoined = (p: RemoteParticipant) => {
    const peer = toPeer(p)
    this.peers.set(peer.id, peer)
    this.h.onPeerJoined(peer)
    this.h.onPeerLink(peer, 'open')
  }

  private onLeft = (p: RemoteParticipant) => {
    const peer = this.peers.get(p.identity) ?? toPeer(p)
    this.peers.delete(p.identity)
    this.h.onPeerLeft(peer)
  }

  private onState = (s: ConnectionState) => {
    if (s === ConnectionState.Connected) {
      this.welcome()
      // repopulate after a reconnect: the remote set can change while
      // the link was down
      for (const p of this.room.remoteParticipants.values()) {
        if (!this.peers.has(p.identity)) this.onJoined(p)
      }
    }
    const sig: SignalState =
      s === ConnectionState.Connected
        ? { status: 'online', attempt: 0 }
        : s === ConnectionState.Disconnected
          ? { status: 'offline', attempt: 0 }
          : { status: 'reconnecting', attempt: 0 }
    this.h.onConnectionState(sig)
  }

  private onData = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ) => {
    if (this.closed || topic !== TOPIC || !participant) return
    const peer = this.peers.get(participant.identity) ?? toPeer(participant)
    if (payload[0] === CHUNK_TAG) {
      this.onChunk(peer, payload)
      return
    }
    try {
      const w = JSON.parse(dec.decode(payload))
      if (w && w.t === 'fileh') {
        this.onFileHeader(peer, w)
        return
      }
      routeWire(this.h, peer, w, this.opts.maxFileBytes)
    } catch {
      // malformed frame, drop
    }
  }

  private send(frame: object) {
    void this.room.localParticipant
      .publishData(enc.encode(JSON.stringify(frame)), {
        reliable: true,
        topic: TOPIC,
      })
      .catch(() => {})
  }

  // ---- ChatSession ----

  broadcastChat(body: string, file?: FileMeta, reply?: unknown): string {
    const id = `${this.self?.id ?? 'me'}-${newNonce()}`
    this.send({
      t: 'chat',
      id,
      ts: Date.now(),
      body,
      file,
      ...(reply ? { reply } : {}),
    })
    return id
  }

  broadcastTyping(on: boolean) {
    this.send({ t: 'typing', on })
  }

  broadcastDelete(id: string) {
    this.send({ t: 'delete', id })
  }

  broadcastReact(id: string, emoji: string, on: boolean) {
    this.send({ t: 'react', id, emoji, on })
  }

  broadcastPresent(msgId: string, on: boolean) {
    this.send({ t: 'present', id: msgId, on })
  }

  broadcastSound(name: string) {
    this.send({ t: 'sound', name })
  }

  broadcastRename(name: string) {
    if (this.self) this.self.name = name
    this.send({ t: 'rename', name })
  }

  broadcastAvatar(data: string) {
    this.send({ t: 'avatar', data })
  }

  async sendFile(file: Blob, meta: FileMeta, msgId: string) {
    const self = this.self ?? { id: 'me', name: 'me' }
    this.send({
      t: 'fileh',
      id: meta.id,
      msgId,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
    })
    const buf = new Uint8Array(await file.arrayBuffer())
    const idBytes = enc.encode(meta.id)
    let seq = 0
    for (let off = 0; off < buf.byteLength; off += LK_CHUNK) {
      if (this.closed) return
      const part = buf.subarray(off, off + LK_CHUNK)
      const frame = new Uint8Array(3 + idBytes.length + 4 + part.byteLength)
      const dv = new DataView(frame.buffer)
      frame[0] = CHUNK_TAG
      dv.setUint16(1, idBytes.length)
      frame.set(idBytes, 3)
      dv.setUint32(3 + idBytes.length, seq++)
      frame.set(part, 7 + idBytes.length)
      try {
        await this.room.localParticipant.publishData(frame, {
          reliable: true,
          topic: TOPIC,
        })
      } catch {
        this.h.onFileError(meta.id, msgId, self, 'send failed')
        return
      }
      this.h.onFileProgress({
        fileId: meta.id,
        msgId,
        peer: self,
        dir: 'up',
        done: Math.min(off + LK_CHUNK, buf.byteLength),
        total: buf.byteLength,
      })
    }
  }

  private onFileHeader(peer: Peer, w: Record<string, unknown>) {
    const id = String(w.id ?? '')
    const size = Number(w.size)
    if (!id || !Number.isFinite(size) || size <= 0 || size > this.opts.maxFileBytes)
      return
    this.files.set(`${peer.id}:${id}`, {
      header: {
        id,
        msgId: String(w.msgId ?? ''),
        name: String(w.name ?? 'file').slice(0, 255),
        size,
        mime: String(w.mime ?? ''),
      },
      peer,
      chunks: [],
      received: 0,
    })
  }

  private onChunk(peer: Peer, payload: Uint8Array) {
    if (payload.byteLength < 8) return
    const dv = new DataView(payload.buffer, payload.byteOffset)
    const idLen = dv.getUint16(1)
    if (payload.byteLength < 7 + idLen) return
    const id = dec.decode(payload.subarray(3, 3 + idLen))
    const seq = dv.getUint32(3 + idLen)
    const body = payload.subarray(7 + idLen)
    const f = this.files.get(`${peer.id}:${id}`)
    if (!f || seq > 1 << 22) return
    if (!f.chunks[seq]) {
      f.chunks[seq] = new Blob([body.slice()])
      f.received += body.byteLength
      this.h.onFileProgress({
        fileId: id,
        msgId: f.header.msgId,
        peer,
        dir: 'down',
        done: f.received,
        total: f.header.size,
      })
    }
    if (f.received >= f.header.size) {
      this.files.delete(`${peer.id}:${id}`)
      const blob = new Blob(f.chunks as Blob[], { type: f.header.mime })
      this.h.onFileDone(id, f.header.msgId, peer, blob)
    }
  }

  reconnect() {
    // the livekit sdk auto reconnects, nothing extra to dial
  }

  close() {
    this.closed = true
    const room = this.room
    room.off(RoomEvent.DataReceived, this.onData)
    room.off(RoomEvent.ParticipantConnected, this.onJoined)
    room.off(RoomEvent.ParticipantDisconnected, this.onLeft)
    room.off(RoomEvent.ConnectionStateChanged, this.onState)
  }
}
