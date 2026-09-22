// SPDX-License-Identifier: 0BSD
import { useEffect, useRef, useState } from 'react'
import {
  LayoutGrid,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  UserRound,
  Video,
  VideoOff,
} from 'lucide-react'
import { cn } from '../lib/cn'

// demo stage renders seeded participants from generated canvas streams, so
// tiles are real video elements: picture in picture and fullscreen work
// exactly like they do on livekit tracks, with zero server or network
type MediaKind = 'cam' | 'screen' | 'voice'
type View = 'grid' | 'speaker'

interface DemoTile {
  id: string
  name: string
  kind: MediaKind
  muted: boolean
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  seed: string,
  kind: MediaKind,
  t: number,
) {
  const { width, height } = ctx.canvas
  const hue = hash(seed) % 360
  const g = ctx.createLinearGradient(0, 0, width, height)
  g.addColorStop(0, `hsl(${hue} 20% ${11 + Math.sin(t) * 2.5}%)`)
  g.addColorStop(1, `hsl(${(hue + 50) % 360} 16% ${7 + Math.cos(t * 0.7) * 2}%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, width, height)

  if (kind === 'screen') {
    // fake editor window
    ctx.fillStyle = 'rgb(0 0 0 / 0.35)'
    ctx.fillRect(40, 40, width - 80, height - 80)
    ctx.font = '14px monospace'
    const lines = [
      '$ pnpm dev',
      '> quickchat',
      '  mesh: 3 peers',
      '  webrtc: connected',
      '',
    ]
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? `hsl(${hue} 40% 65%)` : 'rgb(255 255 255 / 0.45)'
      ctx.fillText(lines[i], 64, 84 + i * 24)
    }
    // blinking cursor
    if (Math.sin(t * 8) > 0) {
      ctx.fillStyle = 'rgb(255 255 255 / 0.7)'
      ctx.fillRect(64, 84 + 4 * 24 - 11, 8, 14)
    }
  } else {
    // audio waveform-ish bars + initial
    ctx.fillStyle = 'rgb(255 255 255 / 0.08)'
    const cx = width / 2
    const cy = height / 2
    ctx.beginPath()
    ctx.arc(cx, cy - 20, 46, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgb(255 255 255 / 0.75)'
    ctx.font = '600 34px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(seed.slice(0, 1).toUpperCase(), cx, cy - 8)
    for (let i = 0; i < 9; i++) {
      const h = 6 + Math.abs(Math.sin(t * 5 + i)) * 16
      ctx.fillStyle = 'rgb(255 255 255 / 0.25)'
      ctx.fillRect(cx - 52 + i * 12, cy + 52 - h / 2, 5, h)
    }
  }
}

function useFakeStream(seed: string, kind: MediaKind) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (kind === 'voice') return
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    const video = ref.current
    if (!ctx || !video) return
    let raf = 0
    let t = hash(seed) % 10
    const draw = () => {
      t += 0.016
      drawTile(ctx, seed, kind, t)
      raf = requestAnimationFrame(draw)
    }
    draw()
    const stream = canvas.captureStream(30)
    video.srcObject = stream
    void video.play().catch(() => {})
    return () => {
      cancelAnimationFrame(raf)
      for (const tr of stream.getTracks()) tr.stop()
      video.srcObject = null
    }
  }, [seed, kind])
  return ref
}

function Tile({
  tile,
  speaking,
  featured,
  strip,
  camOff,
}: {
  tile: DemoTile
  speaking: boolean
  featured?: boolean
  strip?: boolean
  camOff?: boolean
}) {
  const videoRef = useFakeStream(tile.id, tile.kind)
  const tileRef = useRef<HTMLDivElement>(null)
  const [pip, setPip] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const enter = () => setPip(true)
    const leave = () => setPip(false)
    el.addEventListener('enterpictureinpicture', enter)
    el.addEventListener('leavepictureinpicture', leave)
    return () => {
      el.removeEventListener('enterpictureinpicture', enter)
      el.removeEventListener('leavepictureinpicture', leave)
    }
  }, [videoRef])

  return (
    <div
      ref={tileRef}
      className={cn(
        'group relative aspect-video overflow-hidden rounded-lg border bg-recessed',
        tile.kind === 'screen' && !featured && 'sm:col-span-2',
        featured && 'h-full w-full',
        strip && 'aspect-video w-40 shrink-0',
        speaking ? 'border-success' : 'border-border',
      )}
    >
      {camOff || tile.kind === 'voice' ? (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full border border-border-strong bg-card text-lg font-semibold text-muted-foreground">
            {tile.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
      ) : (
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-0.5 backdrop-blur-sm">
        <span className="max-w-32 truncate text-xs font-medium text-foreground">
          {tile.kind === 'screen' ? `${tile.name} (screen)` : tile.name}
        </span>
        {tile.muted ? (
          <MicOff className="size-3 text-destructive" aria-label="muted" />
        ) : (
          tile.kind !== 'screen' && (
            <Mic className="size-3 text-muted-foreground" aria-hidden />
          )
        )}
        {tile.kind === 'screen' && <MonitorUp className="size-3 text-muted-foreground" />}
      </div>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {!camOff && tile.kind !== 'voice' && document.pictureInPictureEnabled && (
          <button
            aria-label="picture in picture"
            aria-pressed={pip}
            title="picture in picture"
            onClick={() => {
              const el = videoRef.current
              if (!el) return
              if (document.pictureInPictureElement === el)
                void document.exitPictureInPicture()
              else void el.requestPictureInPicture()
            }}
            className="rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-foreground"
          >
            <PictureInPicture2 className="size-3.5" aria-hidden />
          </button>
        )}
        <button
          aria-label="fullscreen tile"
          title="fullscreen tile"
          onClick={() => void tileRef.current?.requestFullscreen()}
          className="rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-foreground"
        >
          <Maximize className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

const toggleClass = cn(
  'flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2',
  'text-sm font-medium text-muted-foreground hover:bg-hover hover:text-foreground',
  'aria-pressed:border-border-strong aria-pressed:text-emphasis',
)

export default function DemoStage() {
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(true)
  const [sharing, setSharing] = useState(true)
  const [view, setView] = useState<View>('grid')
  const [fullscreen, setFullscreen] = useState(false)
  const [speaking, setSpeaking] = useState('nova')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // cycle the speaking highlight for a live feel
  useEffect(() => {
    const names = ['nova', 'rex', 'ash', 'you']
    let i = 0
    const id = setInterval(() => setSpeaking(names[i++ % names.length]), 2600)
    return () => clearInterval(id)
  }, [])

  const tiles: DemoTile[] = [
    { id: 'nova', name: 'nova', kind: 'cam', muted: false },
    { id: 'rex', name: 'rex', kind: 'cam', muted: true },
    { id: 'ash', name: 'ash', kind: 'voice', muted: false },
    { id: 'you', name: 'you', kind: 'cam', muted: !mic },
    ...(sharing
      ? [{ id: 'rex-screen', name: 'rex', kind: 'screen' as const, muted: false }]
      : []),
  ]

  const featured =
    view === 'speaker' ? (tiles.find((t) => t.kind === 'screen') ?? tiles[0]) : undefined
  const rest = featured ? tiles.filter((t) => t !== featured) : tiles

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {featured ? (
          <div className="flex h-full flex-col gap-3">
            <div className="min-h-0 flex-1">
              <Tile
                tile={featured}
                featured
                speaking={speaking === featured.name}
                camOff={featured.id === 'you' && !cam}
              />
            </div>
            {rest.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {rest.map((t) => (
                  <Tile
                    key={t.id}
                    tile={t}
                    strip
                    speaking={speaking === t.name && t.kind === 'cam'}
                    camOff={t.id === 'you' && !cam}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid h-fit grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((t) => (
              <Tile
                key={t.id}
                tile={t}
                speaking={speaking === t.name && t.kind === 'cam'}
                camOff={t.id === 'you' && !cam}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-3">
        <button
          onClick={() => setMic(!mic)}
          aria-label="microphone"
          aria-pressed={mic}
          title="microphone"
          className={toggleClass}
        >
          {mic ? (
            <Mic className="size-4" />
          ) : (
            <MicOff className="size-4 text-destructive" />
          )}
        </button>
        <button
          onClick={() => setCam(!cam)}
          aria-label="camera"
          aria-pressed={cam}
          title="camera"
          className={toggleClass}
        >
          {cam ? <Video className="size-4" /> : <VideoOff className="size-4" />}
        </button>
        <button
          onClick={() => setSharing(!sharing)}
          aria-label="share screen"
          aria-pressed={sharing}
          title="share screen"
          className={toggleClass}
        >
          <MonitorUp className="size-4" />
        </button>
        <button
          onClick={() => setView(view === 'grid' ? 'speaker' : 'grid')}
          aria-label={view === 'grid' ? 'speaker view' : 'grid view'}
          aria-pressed={view === 'speaker'}
          title={view === 'grid' ? 'speaker view' : 'grid view'}
          className={toggleClass}
        >
          {view === 'grid' ? (
            <UserRound className="size-4" />
          ) : (
            <LayoutGrid className="size-4" />
          )}
        </button>
        <button
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen()
            else void rootRef.current?.requestFullscreen()
          }}
          aria-label={fullscreen ? 'exit fullscreen' : 'fullscreen'}
          aria-pressed={fullscreen}
          title={fullscreen ? 'exit fullscreen' : 'fullscreen'}
          className={toggleClass}
        >
          {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </button>
        <span className={cn(toggleClass, 'text-destructive hover:bg-destructive/10')}>
          <PhoneOff className="size-4" />
        </span>
      </div>
    </div>
  )
}
