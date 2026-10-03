import type { Peer } from './types'

const BASE_BACKOFF_MS = 500
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

// SignalStatus describes the socket lifecycle for ui feedback:
// connecting is the first dial, reconnecting means an established
// session was lost and backoff is running, offline means the browser
// reports no network so no dial is even attempted.
export type SignalStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

export interface SignalState {
  status: SignalStatus
  /** consecutive failed dials; 0 while online or on the first attempt */
  attempt: number
}

// SignalingSocket carries presence and WebRTC signaling only. Chat and
// file payloads never transit it.
export class SignalingSocket {
  private ws: WebSocket | null = null
  private room = ''
  private name = ''
  private attempts = 0
  private everConnected = false
  private closed = false
  private listening = false
  private timer: number | null = null
  // signals sent while disconnected are queued and flushed on open so a
  // reconnect does not silently drop negotiation
  private queue: string[] = []

  onEvent: (e: SignalEvent) => void = () => {}
  onStateChange: (s: SignalState) => void = () => {}

  connect(room: string, name: string) {
    this.room = room
    this.name = name
    this.closed = false
    this.attempts = 0
    this.everConnected = false
    if (!this.listening) {
      this.listening = true
      window.addEventListener('online', this.onOnline)
      window.addEventListener('offline', this.onOffline)
    }
    if (navigator.onLine) {
      this.report('connecting')
      this.dial()
    } else {
      this.report('offline')
    }
  }

  private report(status: SignalStatus) {
    this.onStateChange({ status, attempt: this.attempts })
  }

  private onOnline = () => {
    if (this.closed) return
    this.attempts = 0
    this.report(this.everConnected ? 'reconnecting' : 'connecting')
    this.dial()
  }

  private onOffline = () => {
    if (this.closed) return
    // a dead socket still fires onclose; report offline once and stop
    // scheduling until the browser comes back
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    try {
      this.ws?.close()
    } catch {
      // already closing
    }
    this.report('offline')
  }

  private dial() {
    if (this.closed) return
    // a manual retry or online event can race an in-flight dial: detach
    // the old socket so its events cannot be mistaken for the new one
    const prev = this.ws
    if (prev) {
      prev.onopen = prev.onmessage = prev.onclose = prev.onerror = null
      try {
        prev.close()
      } catch {
        // already closed
      }
      this.ws = null
    }
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
      if (this.ws !== ws) return
      this.attempts = 0
      this.everConnected = true
      this.report('online')
      const queued = this.queue
      this.queue = []
      for (const data of queued) {
        try {
          ws.send(data)
        } catch {
          break
        }
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.timer !== null) return
    if (!navigator.onLine) {
      this.report('offline')
      return
    }
    // equal jitter: half deterministic backoff plus a random half, so
    // many clients dropping together do not redial in lockstep
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** this.attempts, MAX_BACKOFF_MS)
    const delay = backoff / 2 + Math.random() * (backoff / 2)
    this.attempts++
    this.report(this.everConnected ? 'reconnecting' : 'connecting')
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.dial()
    }, delay)
  }

  // retryNow skips the remaining backoff; used by the manual retry
  // affordance and safe to call while online
  retryNow() {
    if (this.closed || this.ws?.readyState === WebSocket.OPEN) return
    // dialing a dead network can wedge a socket without events; stay
    // in offline until the browser reports connectivity
    if (!navigator.onLine) {
      this.report('offline')
      return
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    this.report(this.everConnected ? 'reconnecting' : 'connecting')
    this.dial()
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
    if (this.listening) {
      this.listening = false
      window.removeEventListener('online', this.onOnline)
      window.removeEventListener('offline', this.onOffline)
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
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
