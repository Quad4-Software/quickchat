// SPDX-License-Identifier: 0BSD
// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

// the model stays behind a dynamic import, and vitest resolves the
// same specifier so the mock intercepts the lazy load
vi.mock('@workadventure/noise-suppression/deepfilternet', () => ({
  createDeepFilterNetAudioWorklet: vi.fn(),
}))

import { createDeepFilterNetAudioWorklet } from '@workadventure/noise-suppression/deepfilternet'
import { DeepFilterNetProcessor } from './dfnproc'
import {
  disableNoiseSuppression,
  enableNoiseSuppression,
  micCaptureConstraints,
  nsupPreferred,
  setNsupPreferred,
} from './noisefilter'

const createWorklet = vi.mocked(createDeepFilterNetAudioWorklet)

function fakeRawTrack() {
  return { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack
}

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeAudioContext {
  state = 'suspended'
  closed = false
  createdNodes: FakeNode[] = []
  sources: { stream: unknown; node: FakeNode }[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
    this.closed = true
  })
  createMediaStreamSource(stream: MediaStream) {
    const node = new FakeNode()
    this.sources.push({ stream, node })
    this.createdNodes.push(node)
    return node
  }
  createMediaStreamDestination() {
    const node = new FakeNode() as FakeNode & { stream: MediaStream }
    const t = { kind: 'audio', stop: vi.fn() }
    node.stream = new FakeMediaStream([
      t,
    ] as unknown as MediaStreamTrack[]) as unknown as MediaStream
    processedTracks.push(t)
    this.createdNodes.push(node)
    return node
  }
}

let contexts: FakeAudioContext[] = []
let ctxArgs: unknown[] = []
let processedTracks: { stop: ReturnType<typeof vi.fn> }[] = []

class FakeMediaStream {
  tracks: MediaStreamTrack[]
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks
  }
  getAudioTracks() {
    return this.tracks
  }
}

function fakeOpts(track: MediaStreamTrack) {
  return {
    kind: 'audio',
    track,
    audioContext: {} as AudioContext,
  } as never
}

beforeEach(() => {
  contexts = []
  ctxArgs = []
  processedTracks = []
  localStorage.clear()
  createWorklet.mockReset()
  createWorklet.mockImplementation(async (_ctx, opts) => {
    const node = new FakeNode()
    const ready = Promise.resolve({ ok: true })
    return {
      node,
      ready,
      dispose: vi.fn(),
      // surface the options so tests can reach onOverload
      ...{ __opts: opts },
    } as never
  })
  vi.stubGlobal(
    'AudioContext',
    class extends FakeAudioContext {
      constructor(opts?: AudioContextOptions) {
        super()
        ctxArgs.push(opts)
        contexts.push(this)
      }
    },
  )
  vi.stubGlobal('MediaStream', FakeMediaStream)
})

function optsOf(call = 0) {
  return (createWorklet.mock.calls[call]?.[1] ?? {}) as {
    onOverload?: () => void
  }
}

describe('micCaptureConstraints', () => {
  it('strips the browser denoiser only when ml is on', () => {
    expect(micCaptureConstraints(true)).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    })
    expect(micCaptureConstraints(false)).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    })
  })
})

describe('nsup preference', () => {
  it('round trips through localStorage and defaults off', () => {
    expect(nsupPreferred()).toBe(false)
    setNsupPreferred(true)
    expect(nsupPreferred()).toBe(true)
    setNsupPreferred(false)
    expect(nsupPreferred()).toBe(false)
  })
})

describe('DeepFilterNetProcessor', () => {
  it('builds a 48 khz graph and exposes the processed track', async () => {
    const raw = fakeRawTrack()
    const proc = new DeepFilterNetProcessor()
    expect(proc.name).toBe('qc-deepfilternet')
    await proc.init(fakeOpts(raw))
    expect(contexts).toHaveLength(1)
    expect(ctxArgs[0]).toEqual({ sampleRate: 48000 })
    expect(contexts[0].resume).toHaveBeenCalled()
    expect(createWorklet).toHaveBeenCalledOnce()
    // the processor ignores the context livekit hands it
    const src = contexts[0].sources[0]
    expect((src.stream as FakeMediaStream).tracks).toEqual([raw])
    expect(src.node.connect).toHaveBeenCalled()
    expect(proc.processedTrack).toBe(processedTracks[0])
    expect(raw.stop).not.toHaveBeenCalled()
  })

  it('destroy is idempotent and never stops the raw track', async () => {
    const raw = fakeRawTrack()
    const proc = new DeepFilterNetProcessor()
    await proc.init(fakeOpts(raw))
    await proc.destroy()
    await proc.destroy()
    expect(processedTracks[0].stop).toHaveBeenCalledTimes(1)
    expect(raw.stop).not.toHaveBeenCalled()
    expect(contexts[0].close).toHaveBeenCalledTimes(1)
    expect(proc.processedTrack).toBeUndefined()
  })

  it('destroy before init is a no-op', async () => {
    const proc = new DeepFilterNetProcessor()
    await proc.destroy()
    expect(contexts).toHaveLength(0)
  })

  it('leaks nothing when init fails halfway', async () => {
    const onError = vi.fn()
    createWorklet.mockImplementation(async () => {
      throw new Error('wasm exploded')
    })
    const proc = new DeepFilterNetProcessor({ onError })
    await expect(proc.init(fakeOpts(fakeRawTrack()))).rejects.toThrow('wasm exploded')
    expect(onError).toHaveBeenCalledOnce()
    // the context opened before the failure is closed again
    expect(contexts[0].close).toHaveBeenCalled()
    expect(proc.processedTrack).toBeUndefined()
    // and a later destroy stays safe
    await proc.destroy()
  })

  it('rebuilds the graph on restart and keeps the context', async () => {
    const proc = new DeepFilterNetProcessor()
    await proc.init(fakeOpts(fakeRawTrack()))
    const second = fakeRawTrack()
    await proc.restart(fakeOpts(second))
    expect(contexts).toHaveLength(1)
    expect(createWorklet).toHaveBeenCalledTimes(2)
    // the first processed track was stopped, a fresh one exposed
    expect(processedTracks[0].stop).toHaveBeenCalledTimes(1)
    expect(proc.processedTrack).not.toBe(processedTracks[0])
  })

  it('invokes the overload callback from the worklet options', async () => {
    const onOverload = vi.fn()
    const proc = new DeepFilterNetProcessor({ onOverload })
    await proc.init(fakeOpts(fakeRawTrack()))
    optsOf().onOverload?.()
    expect(onOverload).toHaveBeenCalledOnce()
  })
})

describe('enable/disable', () => {
  function fakeTrack() {
    return {
      restartTrack: vi.fn(async () => {}),
      setProcessor: vi.fn(async () => {}),
      stopProcessor: vi.fn(async () => {}),
    } as never
  }

  it('recaptures without browser ns before setting the processor', async () => {
    const track = fakeTrack()
    const proc = await enableNoiseSuppression(track)
    const t = track as unknown as {
      restartTrack: ReturnType<typeof vi.fn>
      setProcessor: ReturnType<typeof vi.fn>
    }
    expect(t.restartTrack).toHaveBeenCalledWith({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    })
    expect(t.setProcessor).toHaveBeenCalledWith(proc)
    // restart ran first so the processor inits on the final raw track
    expect(t.restartTrack.mock.invocationCallOrder[0]).toBeLessThan(
      t.setProcessor.mock.invocationCallOrder[0],
    )
    await proc.destroy()
  })

  it('drops the processor and restores browser ns on disable', async () => {
    const track = fakeTrack()
    await disableNoiseSuppression(track)
    const t = track as unknown as {
      restartTrack: ReturnType<typeof vi.fn>
      stopProcessor: ReturnType<typeof vi.fn>
    }
    expect(t.stopProcessor).toHaveBeenCalled()
    expect(t.restartTrack).toHaveBeenCalledWith({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    })
  })

  it('cleans up when setProcessor rejects', async () => {
    const track = {
      restartTrack: vi.fn(async () => {}),
      // livekit runs processor.init inside setProcessor, so a late
      // reject still leaves an open context that must be closed
      setProcessor: vi.fn(async (proc: DeepFilterNetProcessor) => {
        await proc.init(fakeOpts(fakeRawTrack()))
        throw new Error('no dice')
      }),
      stopProcessor: vi.fn(async () => {}),
    } as never
    await expect(enableNoiseSuppression(track)).rejects.toThrow('no dice')
    expect(contexts[0].close).toHaveBeenCalled()
  })
})
