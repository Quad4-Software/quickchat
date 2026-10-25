// SPDX-License-Identifier: 0BSD
// Room construction options shared between the stage and any caller
// that creates the Room manually to share the sfu connection.

import { ExternalE2EEKeyProvider, isE2EESupported } from 'livekit-client'
import type { RoomOptions } from 'livekit-client'
import { micCaptureConstraints, nsupPreferred } from './noisefilter'

// e2eeUsable reports whether media encryption can actually run, since
// browsers without insertable streams silently fall back to dtls-srtp
export function e2eeUsable(e2eeKey?: string | null): boolean {
  return Boolean(e2eeKey) && isE2EESupported()
}

// roomOptions builds the options a Room must be constructed with.
// LiveKitRoom ignores its own options when handed a manual Room, so
// callers that share the room across components must bake these in at
// construction time.
export function roomOptions(e2eeKey?: string | null): RoomOptions {
  const opts: RoomOptions = { webAudioMix: true }
  // with ml noise suppression the mic must be captured without the
  // browser denoiser so the two never stack
  if (nsupPreferred()) {
    opts.audioCaptureDefaults = micCaptureConstraints(true)
  }
  const e2eeUsable = Boolean(e2eeKey) && isE2EESupported()
  if (e2eeUsable && e2eeKey) {
    const keyProvider = new ExternalE2EEKeyProvider()
    void keyProvider.setKey(e2eeKey)
    opts.encryption = {
      keyProvider,
      worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url)),
    }
  }
  return opts
}
