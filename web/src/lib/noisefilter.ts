// SPDX-License-Identifier: 0BSD
// Optional ML noise suppression for the local microphone. DeepFilterNet3
// runs in an AudioWorklet fully client side. The processor module is
// imported lazily the first time the toggle is enabled so the model
// megabytes stay out of the initial bundle.

import { LocalAudioTrack, Track } from 'livekit-client'
import type { LocalTrackPublication, Room } from 'livekit-client'
import type { DeepFilterNetProcessor, NsupCallbacks } from './dfnproc'

const NSUP_KEY = 'qc-nsup'

export type { DeepFilterNetProcessor, NsupCallbacks }

export function nsupSupported(): boolean {
  return (
    typeof AudioContext !== 'undefined' &&
    'audioWorklet' in AudioContext.prototype &&
    typeof WebAssembly !== 'undefined'
  )
}

export function nsupPreferred(): boolean {
  try {
    return localStorage.getItem(NSUP_KEY) === '1'
  } catch {
    return false
  }
}

export function setNsupPreferred(on: boolean) {
  try {
    localStorage.setItem(NSUP_KEY, on ? '1' : '0')
  } catch {
    // private mode may deny storage, the toggle just stays session only
  }
}

// The browser denoiser must not feed the model: stacking the two
// denoisers starves DeepFilterNet of the noise it subtracts. Echo
// cancellation and gain stay on either way.
export function micCaptureConstraints(on: boolean) {
  return {
    noiseSuppression: !on,
    echoCancellation: true,
    autoGainControl: true,
  }
}

export function localMicTrack(room: Room): LocalAudioTrack | undefined {
  const pub: LocalTrackPublication | undefined =
    room.localParticipant.getTrackPublication(Track.Source.Microphone)
  const track = pub?.track
  return track instanceof LocalAudioTrack ? track : undefined
}

// enableNoiseSuppression recaptures the mic without the browser
// denoiser first so setProcessor inits the worklet on the final raw
// track instead of rebuilding it twice through the restart path.
export async function enableNoiseSuppression(
  track: LocalAudioTrack,
  callbacks?: NsupCallbacks,
): Promise<DeepFilterNetProcessor> {
  const { DeepFilterNetProcessor } = await import('./dfnproc')
  const proc = new DeepFilterNetProcessor(callbacks)
  try {
    await track.restartTrack(micCaptureConstraints(true))
    await track.setProcessor(proc)
  } catch (err) {
    await proc.destroy()
    throw err
  }
  return proc
}

export async function disableNoiseSuppression(track: LocalAudioTrack): Promise<void> {
  await track.stopProcessor()
  await track.restartTrack(micCaptureConstraints(false))
}
