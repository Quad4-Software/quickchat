// SPDX-License-Identifier: 0BSD
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// The processor is reached from a built lazy chunk: the spec locates it
// by the livekit processor name rather than a hashed filename so chunk
// renaming never breaks the lookup.
function assetUrl(marker: string): string {
  const dir = fileURLToPath(new URL('../dist/assets', import.meta.url))
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    if (
      readFileSync(
        fileURLToPath(new URL(`../dist/assets/${f}`, import.meta.url)),
        'utf8',
      ).includes(marker)
    ) {
      return `/assets/${f}`
    }
  }
  throw new Error(`no dist asset contains ${marker}`)
}

test('deepfilternet worklet loads under the real csp and denoises', async ({ page }) => {
  test.setTimeout(90_000)
  const cspViolations: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && /content security policy|refused to|csp/i.test(t)) {
      cspViolations.push(t)
    }
  })
  page.on('pageerror', (e) => cspViolations.push(String(e)))

  await page.goto('/', { waitUntil: 'commit' })
  const chunk = assetUrl('qc-deepfilternet')

  const result = await page.evaluate(async (url) => {
    const { DeepFilterNetProcessor } = (await import(url)) as {
      DeepFilterNetProcessor: new () => {
        processedTrack?: MediaStreamTrack
        init(opts: {
          kind: string
          track: MediaStreamTrack
          audioContext: AudioContext
        }): Promise<void>
        destroy(): Promise<void>
      }
    }

    const actx = new AudioContext({ sampleRate: 48000 })
    await actx.resume()

    // synthetic input: looping broadband white noise, loud enough that
    // the denoiser has something to remove
    const len = actx.sampleRate * 4
    const buf = actx.createBuffer(1, len, 48000)
    const data = buf.getChannelData(0)
    let seed = 22222
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647
      data[i] = (seed / 2147483647) * 0.4 - 0.2
    }
    const noise = actx.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const rawDest = actx.createMediaStreamDestination()
    noise.connect(rawDest)
    const inMeter = actx.createAnalyser()
    inMeter.fftSize = 2048
    noise.connect(inMeter)
    noise.start()

    const rawTrack = rawDest.stream.getAudioTracks()[0]
    const proc = new DeepFilterNetProcessor()
    // init only resolves once the worklet posts ready, which requires
    // the module, wasm and model fetches to all pass the csp
    await proc.init({
      kind: 'audio',
      track: rawTrack,
      audioContext: actx,
    })
    if (!proc.processedTrack) throw new Error('no processed track')

    const outSrc = actx.createMediaStreamSource(new MediaStream([proc.processedTrack]))
    const outMeter = actx.createAnalyser()
    outMeter.fftSize = 2048
    outSrc.connect(outMeter)

    const rms = (a: AnalyserNode) => {
      const b = new Float32Array(a.fftSize)
      a.getFloatTimeDomainData(b)
      let s = 0
      for (const v of b) s += v * v
      return Math.sqrt(s / b.length)
    }

    // let the model warm up past its pause gate and frame buffers
    await new Promise((r) => setTimeout(r, 5000))
    const inRms = rms(inMeter)
    const outRms = rms(outMeter)

    await proc.destroy()
    await actx.close()
    return { inRms, outRms }
  }, chunk)

  expect(cspViolations, `csp/console violations: ${cspViolations.join('; ')}`).toEqual([])
  expect(Number.isFinite(result.inRms)).toBe(true)
  expect(Number.isFinite(result.outRms)).toBe(true)
  // the synthetic noise must be audible on the input
  expect(result.inRms).toBeGreaterThan(0.01)
  // and the processed output must be non-silent but materially
  // attenuated: pure broadband noise is what the model removes
  expect(result.outRms).toBeGreaterThan(0)
  expect(result.outRms).toBeLessThan(result.inRms * 0.5)
})
