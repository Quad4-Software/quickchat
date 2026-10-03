// SPDX-License-Identifier: 0BSD
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignalingSocket } from './signal'
import type { SignalState } from './signal'

// minimal websocket double: tests drive open and close by hand so the
// reconnect state machine is exercised deterministically
class FakeWS {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWS[] = []

  readonly url: string
  readyState = FakeWS.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }

  send(data: string) {
    if (this.readyState !== FakeWS.OPEN) throw new Error('send on closed socket')
    this.sent.push(data)
  }

  close() {
    if (this.readyState === FakeWS.CLOSED) return
    this.readyState = FakeWS.CLOSED
    this.onclose?.()
  }

  open() {
    this.readyState = FakeWS.OPEN
    this.onopen?.()
  }
}

const online = { onLine: true }
const listeners = new Map<string, Set<() => void>>()

function fire(type: string) {
  for (const f of listeners.get(type) ?? []) f()
}

function latest() {
  return FakeWS.instances.at(-1)
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWS.instances = []
  listeners.clear()
  online.onLine = true
  vi.stubGlobal('WebSocket', FakeWS)
  vi.stubGlobal('location', { protocol: 'http:', host: 't' })
  vi.stubGlobal('navigator', online)
  vi.stubGlobal('window', {
    addEventListener: (t: string, f: () => void) => {
      let s = listeners.get(t)
      if (!s) listeners.set(t, (s = new Set()))
      s.add(f)
    },
    removeEventListener: (t: string, f: () => void) => listeners.get(t)?.delete(f),
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function states() {
  const seen: SignalState[] = []
  const sock = new SignalingSocket()
  sock.onStateChange = (s) => seen.push(s)
  return { sock, seen }
}

describe('SignalingSocket', () => {
  it('reports connecting then online on a clean dial', () => {
    const { sock, seen } = states()
    sock.connect('r1', 'a')
    expect(seen.map((s) => s.status)).toEqual(['connecting'])
    latest()!.open()
    expect(seen.at(-1)).toEqual({ status: 'online', attempt: 0 })
    expect(latest()!.url).toBe('ws://t/ws/rooms/r1?name=a')
    sock.close()
  })

  it('redials with backoff after a lost connection', () => {
    const { sock, seen } = states()
    sock.connect('r1', 'a')
    latest()!.open()
    const ws1 = latest()!
    ws1.close()
    expect(seen.at(-1)!.status).toBe('reconnecting')
    expect(seen.at(-1)!.attempt).toBe(1)
    // no redial until the jittered backoff fires
    expect(FakeWS.instances).toHaveLength(1)
    vi.advanceTimersByTime(9000)
    expect(FakeWS.instances).toHaveLength(2)
    latest()!.open()
    expect(seen.at(-1)).toEqual({ status: 'online', attempt: 0 })
    sock.close()
  })

  it('reports offline and waits for the browser instead of dialing', () => {
    const { sock, seen } = states()
    sock.connect('r1', 'a')
    latest()!.open()
    online.onLine = false
    fire('offline')
    expect(seen.at(-1)!.status).toBe('offline')
    vi.advanceTimersByTime(30000)
    expect(FakeWS.instances).toHaveLength(1)
    online.onLine = true
    fire('online')
    expect(FakeWS.instances).toHaveLength(2)
    sock.close()
  })

  it('dials straight into offline state when the browser is down', () => {
    online.onLine = false
    const { sock, seen } = states()
    sock.connect('r1', 'a')
    expect(seen.at(-1)!.status).toBe('offline')
    expect(FakeWS.instances).toHaveLength(0)
    sock.close()
  })

  it('flushes queued signals on reconnect', () => {
    const { sock } = states()
    sock.connect('r1', 'a')
    const ws1 = latest()!
    ws1.open()
    ws1.close()
    sock.signal('peer', { candidate: null })
    vi.advanceTimersByTime(9000)
    const ws2 = latest()!
    ws2.open()
    expect(ws2.sent).toHaveLength(1)
    expect(JSON.parse(ws2.sent[0])).toMatchObject({ type: 'signal', to: 'peer' })
    sock.close()
  })

  it('retryNow skips remaining backoff', () => {
    const { sock } = states()
    sock.connect('r1', 'a')
    const ws1 = latest()!
    ws1.open()
    ws1.close()
    sock.retryNow()
    expect(FakeWS.instances).toHaveLength(2)
    sock.close()
  })

  it('does not reconnect after close', () => {
    const { sock } = states()
    sock.connect('r1', 'a')
    latest()!.open()
    sock.close()
    vi.advanceTimersByTime(30000)
    fire('online')
    expect(FakeWS.instances).toHaveLength(1)
  })
})
