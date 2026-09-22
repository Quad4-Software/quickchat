import type { ServerEvent } from './types'

export class ChatSocket {
  private ws: WebSocket | null = null
  onEvent: (e: ServerEvent) => void = () => {}
  onClose: () => void = () => {}

  connect(room: string, name: string) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/ws/rooms/${room}?name=${encodeURIComponent(name)}`
    this.ws = new WebSocket(url)
    this.ws.onmessage = (ev) => {
      try {
        this.onEvent(JSON.parse(ev.data as string) as ServerEvent)
      } catch {
        // ignore malformed frames
      }
    }
    this.ws.onclose = () => this.onClose()
  }

  send(body: string, attachment?: string) {
    this.emit({ type: 'chat', body, attachment: attachment ?? '' })
  }

  setTyping(typing: boolean) {
    this.emit({ type: 'typing', typing })
  }

  close() {
    this.ws?.close()
    this.ws = null
  }

  private emit(v: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(v))
    }
  }
}
