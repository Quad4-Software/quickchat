// SPDX-License-Identifier: 0BSD
// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { roomOptions } from './roomopts'

describe('roomOptions audioCaptureDefaults', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('leaves browser defaults untouched when the pref is off', () => {
    localStorage.setItem('qc-nsup', '0')
    const opts = roomOptions()
    expect(opts.audioCaptureDefaults).toBeUndefined()
    expect(opts.webAudioMix).toBe(true)
  })

  it('leaves browser defaults untouched when the pref is unset', () => {
    const opts = roomOptions()
    expect(opts.audioCaptureDefaults).toBeUndefined()
  })

  it('treats a garbage pref value as off', () => {
    localStorage.setItem('qc-nsup', 'yes please')
    const opts = roomOptions()
    expect(opts.audioCaptureDefaults).toBeUndefined()
  })

  it('disables the browser denoiser when the pref is on', () => {
    localStorage.setItem('qc-nsup', '1')
    const opts = roomOptions()
    expect(opts.audioCaptureDefaults).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    })
  })
})
