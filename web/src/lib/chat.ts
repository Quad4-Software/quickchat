import type { ServerEvent } from './types'

const MAX_BACKOFF_MS = 8000

export class ChatSocket {
  private ws: WebSocket | null = null
  private room = ''
  private name = ''
  private attempts = 0
  private closed = false
  private timer: number | null = null

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

  send(body: string, attachment?: string) {
    this.emit({ type: 'chat', body, attachment: attachment ?? '' })
  }

  setTyping(typing: boolean) {
    this.emit({ type: 'typing', typing })
  }

  close() {
    this.closed = true
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }

  private emit(v: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(v))
    }
  }
}
