import type { ServerEvent } from './types'

const MAX_BACKOFF_MS = 8000
const MAX_QUEUE = 64

export class ChatSocket {
  private ws: WebSocket | null = null
  private room = ''
  private name = ''
  private attempts = 0
  private closed = false
  private timer: number | null = null
  // chat frames sent while disconnected are queued and flushed on open so a
  // reconnect does not silently drop user input
  private queue: string[] = []

  onEvent: (e: ServerEvent) => void = () => {}
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
      try {
        this.onEvent(JSON.parse(ev.data as string) as ServerEvent)
      } catch {
        // ignore malformed frames
      }
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

  send(body: string, attachment?: string, nonce?: string) {
    const data = JSON.stringify({
      type: 'chat',
      body,
      attachment: attachment ?? '',
      nonce: nonce ?? '',
    })
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    } else if (this.queue.length < MAX_QUEUE) {
      this.queue.push(data)
    }
  }

  setTyping(typing: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing', typing }))
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
