// SPDX-License-Identifier: 0BSD
// Soundboard: short sounds published into the livekit room as a
// temporary audio track so peers hear them alongside the mic.
// Built-ins ship as mp3s in public/sounds, sourced from the google
// assistant sound library (CC-BY 4.0) and transcoded to mp3 for
// cross-browser decodeAudioData support. A synth fallback covers
// offline or decode failures.
import type { Room } from 'livekit-client'

export interface SoundDef {
  id: string
  label: string
}

export const SOUNDS: SoundDef[] = [
  { id: 'siren', label: 'siren' },
  { id: 'bugle', label: 'bugle' },
  { id: 'drumroll', label: 'drumroll' },
  { id: 'tada', label: 'ta da' },
  { id: 'ding', label: 'ding' },
  { id: 'pop', label: 'pop' },
  { id: 'boing', label: 'boing' },
  { id: 'cowbell', label: 'cowbell' },
]

let shared: AudioContext | null = null
function ctx(): AudioContext {
  if (!shared) shared = new AudioContext()
  if (shared.state === 'suspended') void shared.resume()
  return shared
}

const rendered = new Map<string, Promise<AudioBuffer>>()

// preset fetches the shipped mp3 and falls back to the offline synth
// render when the file or decoder is unavailable
export function preset(id: string): Promise<AudioBuffer> {
  let b = rendered.get(id)
  if (!b) {
    b = fetch(`${import.meta.env.BASE_URL}sounds/${id}.mp3`)
      .then((r) => {
        if (!r.ok) throw new Error('missing sound')
        return r.arrayBuffer()
      })
      .then((d) => ctx().decodeAudioData(d))
      .catch(() => synth(id))
    rendered.set(id, b)
  }
  return b
}

// decodeFile turns a user file into an audio buffer
export function decodeFile(data: ArrayBuffer): Promise<AudioBuffer> {
  return ctx().decodeAudioData(data)
}

// playSound publishes the buffer as a livekit audio track, plays it
// locally as a monitor, then unpublishes when the buffer ends
export async function playSound(room: Room, buffer: AudioBuffer): Promise<void> {
  const ac = ctx()
  const dest = ac.createMediaStreamDestination()
  const src = ac.createBufferSource()
  src.buffer = buffer
  src.connect(dest)
  // quiet local monitor so the sender hears what went out
  const mon = ac.createGain()
  mon.gain.value = 0.4
  src.connect(mon).connect(ac.destination)
  const mt = dest.stream.getAudioTracks()[0]
  // publishTrack wraps the mediastream track in a local audio track
  // itself, the webaudio destination has no device to reacquire
  await room.localParticipant.publishTrack(mt)
  src.onended = () => {
    void room.localParticipant.unpublishTrack(mt, true).catch(() => {})
    mt.stop()
    mon.disconnect()
    dest.disconnect()
  }
  src.start()
}

// ---- synth fallback ----

type Ctx = OfflineAudioContext

function tone(
  oc: Ctx,
  at: number,
  {
    type = 'sine',
    f,
    dur,
    gain = 0.25,
    slide,
  }: {
    type?: OscillatorType
    f: number
    dur: number
    gain?: number
    slide?: number
  },
) {
  const o = oc.createOscillator()
  const g = oc.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, at)
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur)
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.001, at + dur)
  o.connect(g).connect(oc.destination)
  o.start(at)
  o.stop(at + dur)
}

function noise(oc: Ctx, at: number, dur: number, f: number, gain = 0.25) {
  const len = Math.max(1, Math.ceil(oc.sampleRate * dur))
  const buf = oc.createBuffer(1, len, oc.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const s = oc.createBufferSource()
  s.buffer = buf
  const flt = oc.createBiquadFilter()
  flt.type = 'bandpass'
  flt.frequency.value = f
  flt.Q.value = 0.9
  const g = oc.createGain()
  g.gain.value = gain
  s.connect(flt).connect(g).connect(oc.destination)
  s.start(at)
}

function synth(id: string): Promise<AudioBuffer> {
  const oc = new OfflineAudioContext(1, 48000 * 2, 48000)
  switch (id) {
    case 'siren':
      for (const f of [220, 233, 277])
        tone(oc, 0, { type: 'sawtooth', f, dur: 0.7, gain: 0.18 })
      tone(oc, 0, { type: 'square', f: 110, dur: 0.7, gain: 0.12 })
      break
    case 'ding':
      tone(oc, 0, { f: 880, dur: 0.7, gain: 0.35 })
      tone(oc, 0, { f: 1760, dur: 0.4, gain: 0.15 })
      break
    case 'drumroll':
      for (let i = 0; i < 12; i++) noise(oc, i * 0.055, 0.03, 250, 0.4)
      noise(oc, 0.7, 0.15, 120, 0.6)
      break
    default:
      tone(oc, 0, { f: 660, dur: 0.3 })
  }
  return oc.startRendering()
}
