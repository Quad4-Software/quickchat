// SPDX-License-Identifier: 0BSD
// DeepFilterNet3 as a livekit audio TrackProcessor. This module is only
// reached through a dynamic import so the processor and its worklet,
// wasm and model stay out of every eagerly loaded chunk.

import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

// DEEPFILTERNET_SAMPLE_RATE: the worklet only accepts a 48 kHz context
const MODEL_SAMPLE_RATE = 48000

export type NsupCallbacks = {
  onOverload?: (() => void) | undefined
  onError?: ((err: unknown) => void) | undefined
}

interface WorkletHandle {
  node: AudioWorkletNode
  ready: Promise<unknown>
  dispose(): void
}

// DeepFilterNetProcessor adapts the workadventure worklet to the livekit
// TrackProcessor contract. It owns its own 48 kHz AudioContext because
// the context livekit passes may run at a different rate, which the
// model rejects outright.
export class DeepFilterNetProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = 'qc-deepfilternet'
  processedTrack?: MediaStreamTrack

  private ctx?: AudioContext | undefined
  private src?: MediaStreamAudioSourceNode | undefined
  private dest?: MediaStreamAudioDestinationNode | undefined
  private handle?: WorkletHandle | undefined
  private callbacks: NsupCallbacks

  constructor(callbacks?: NsupCallbacks) {
    this.callbacks = callbacks ?? {}
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    await this.setup(opts.track)
  }

  // livekit calls restart when the mic track is replaced (device switch,
  // constraint change, unmute after a stopped track). The context
  // survives, only the graph is rebuilt around the new raw track
  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.setup(opts.track)
  }

  async destroy(): Promise<void> {
    this.teardown()
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx && ctx.state !== 'closed') {
      try {
        await ctx.close()
      } catch {
        // closing a suspended or already torn down context can reject
      }
    }
  }

  private async setup(track: MediaStreamTrack): Promise<void> {
    this.teardown()
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new AudioContext({ sampleRate: MODEL_SAMPLE_RATE })
      }
      const ctx = this.ctx
      if (ctx.state === 'suspended') await ctx.resume()
      const { createDeepFilterNetAudioWorklet } =
        await import('@workadventure/noise-suppression/deepfilternet')
      const handle = (await createDeepFilterNetAudioWorklet(ctx, {
        onOverload: () => this.callbacks.onOverload?.(),
      })) as WorkletHandle
      const src = ctx.createMediaStreamSource(new MediaStream([track]))
      const dest = ctx.createMediaStreamDestination()
      src.connect(handle.node)
      handle.node.connect(dest)
      this.handle = handle
      this.src = src
      this.dest = dest
      this.processedTrack = dest.stream.getAudioTracks()[0]
      await handle.ready
    } catch (err) {
      // a half built graph must not leak when init fails. Livekit drops
      // the processor on a rejected init and never calls destroy
      await this.destroy()
      this.callbacks.onError?.(err)
      throw err
    }
  }

  // stops only the processed track. The raw mic track belongs to
  // livekit and is stopped by the track itself
  private teardown() {
    try {
      this.handle?.dispose()
    } catch {
      // dispose of a partially loaded worklet can throw
    }
    try {
      this.src?.disconnect()
      this.handle?.node.disconnect()
      this.dest?.disconnect()
    } catch {
      // disconnect on unconnected nodes can throw
    }
    this.handle = undefined
    this.src = undefined
    this.dest = undefined
    const processed = this.processedTrack
    delete this.processedTrack
    processed?.stop()
  }
}
