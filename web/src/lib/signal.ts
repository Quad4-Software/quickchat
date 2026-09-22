import type { Peer } from './types'

const MAX_BACKOFF_MS = 8000
const MAX_QUEUE = 64

export type SignalEvent =
  | { type: 'welcome'; self: Peer; peers: Peer[] }
  | { type: 'peer_joined'; peer: Peer }
  | { type: 'peer_left'; peer: Peer }
  | { type: 'signal'; from: Peer; data: SignalData }

export interface SignalData {
  desc?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit | null
}

// SignalingSocket carries presence and WebRTC signaling only. Chat and
// file payloads never transit it.
export class SignalingSocket {
  private ws: WebSocket | null = null
  private room = ''
  private name = ''
  private attempts = 0
  private closed = false
  private timer: number | null = null
  // signals sent while disconnected are queued and flushed on open so a
  // reconnect does not silently drop negotiation
  private queue: string[] = []

  onEvent: (e: SignalEvent) => void = () => {}
  onStateChange: (connected: boolean) => void = () => {}

  connect(room: string, name: string) {
    this.room = room
    this.name = name
    this.closed = false
    this.dial()
  }

  private dial() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/ws/rooms/${this.room}?name=${encodeURIComponent(this.name)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onmessage = (ev) => {
      let e: SignalEvent
      try {
        e = JSON.parse(ev.data as string) as SignalEvent
      } catch {
        return // ignore malformed frames
      }
      this.onEvent(e)
    }
    ws.onopen = () => {
      this.attempts = 0
      this.onStateChange(true)
      const queued = this.queue
      this.queue = []
      for (const data of queued) ws.send(data)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.onStateChange(false)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.closed) return
    const delay = Math.min(500 * 2 ** this.attempts, MAX_BACKOFF_MS)
    this.attempts++
    this.timer = window.setTimeout(() => this.dial(), delay)
  }

  signal(to: string, data: SignalData) {
    const frame = JSON.stringify({ type: 'signal', to, data })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame)
    } else if (this.queue.length < MAX_QUEUE) {
      this.queue.push(frame)
    }
  }

  close() {
    this.closed = true
    this.queue = []
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }
}

export function newNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}
