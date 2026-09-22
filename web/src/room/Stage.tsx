import {
  DisconnectButton,
  isTrackReference,
  LiveKitRoom,
  RoomAudioRenderer,
  TrackToggle,
  useIsSpeaking,
  useTracks,
  VideoTrack,
} from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { ExternalE2EEKeyProvider, Track } from 'livekit-client'
import type { RoomOptions } from 'livekit-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutGrid,
  Lock,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  UserRound,
  Video,
} from 'lucide-react'
import { cn } from '../lib/cn'
import type { LiveKitGrant } from '../lib/types'

type TrackRef = TrackReferenceOrPlaceholder
type View = 'grid' | 'speaker'

export default function Stage({
  grant,
  e2eeKey,
}: {
  grant: LiveKitGrant
  e2eeKey?: string | null
}) {
  // the key arrives via URL fragment and is set once; it never reaches the server
  const options = useMemo<RoomOptions | undefined>(() => {
    if (!e2eeKey) return undefined
    const keyProvider = new ExternalE2EEKeyProvider()
    void keyProvider.setKey(e2eeKey)
    return {
      e2ee: {
        keyProvider,
        worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url)),
      },
    }
  }, [e2eeKey])

  // terminate the e2ee worker when the stage unmounts
  useEffect(() => {
    return () => {
      const e2ee = options?.e2ee
      if (e2ee && 'worker' in e2ee) e2ee.worker.terminate()
    }
  }, [options])

  return (
    <LiveKitRoom
      serverUrl={grant.url}
      token={grant.token}
      connect
      audio
      video={false}
      {...(options ? { options } : {})}
      className="flex h-full flex-col"
    >
      {e2eeKey && (
        <p className="flex items-center justify-center gap-1.5 border-b border-border bg-card py-1 font-mono text-[10px] text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          end-to-end encrypted media
        </p>
      )}
      <StageInner />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

function StageInner() {
  const tracks = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  const [view, setView] = useState<View>('grid')
  const [fullscreen, setFullscreen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // speaker view pins the screenshare or the first tile large
  const featured =
    view === 'speaker'
      ? (tracks.find((t) => t.source === Track.Source.ScreenShare) ?? tracks[0])
      : undefined
  const rest = featured ? tracks.filter((t) => t !== featured) : tracks

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              nobody here yet. share the link.
            </p>
          </div>
        ) : featured ? (
          <div className="flex h-full flex-col gap-3">
            <div className="min-h-0 flex-1">
              <Tile track={featured} featured />
            </div>
            {rest.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {rest.map((t) => (
                  <Tile key={`${t.participant.identity}-${t.source}`} track={t} strip />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid h-fit grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tracks.map((t) => (
              <Tile key={`${t.participant.identity}-${t.source}`} track={t} />
            ))}
          </div>
        )}
      </div>
      <Controls
        view={view}
        onView={setView}
        fullscreen={fullscreen}
        onFullscreen={() => {
          if (document.fullscreenElement) void document.exitFullscreen()
          else void rootRef.current?.requestFullscreen()
        }}
      />
    </div>
  )
}

function Tile({
  track,
  featured,
  strip,
}: {
  track: TrackRef
  featured?: boolean
  strip?: boolean
}) {
  const speaking = useIsSpeaking(track.participant)
  const isScreen = track.source === Track.Source.ScreenShare
  const hasVideo = isTrackReference(track)
  const tileRef = useRef<HTMLDivElement>(null)
  const [pip, setPip] = useState(false)

  useEffect(() => {
    const el = tileRef.current?.querySelector('video')
    if (!el) return
    const enter = () => setPip(true)
    const leave = () => setPip(false)
    el.addEventListener('enterpictureinpicture', enter)
    el.addEventListener('leavepictureinpicture', leave)
    return () => {
      el.removeEventListener('enterpictureinpicture', enter)
      el.removeEventListener('leavepictureinpicture', leave)
    }
  }, [hasVideo])

  return (
    <div
      ref={tileRef}
      className={cn(
        'group relative aspect-video overflow-hidden rounded-lg border bg-recessed',
        isScreen && !featured && 'sm:col-span-2',
        featured && 'h-full w-full',
        strip && 'aspect-video w-40 shrink-0',
        speaking ? 'border-success' : 'border-border',
      )}
    >
      {hasVideo ? (
        <VideoTrack trackRef={track} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full border border-border-strong bg-card text-lg font-semibold text-muted-foreground">
            {(track.participant.name || track.participant.identity || '?')
              .slice(0, 1)
              .toUpperCase()}
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-0.5 backdrop-blur-sm">
        <span className="max-w-32 truncate text-xs font-medium text-foreground">
          {track.participant.name || track.participant.identity}
        </span>
        {!track.participant.isMicrophoneEnabled && (
          <MicOff className="size-3 text-destructive" aria-label="muted" />
        )}
        {isScreen && <MonitorUp className="size-3 text-muted-foreground" />}
      </div>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {hasVideo && document.pictureInPictureEnabled && (
          <button
            aria-label="picture in picture"
            aria-pressed={pip}
            title="picture in picture"
            onClick={() => {
              const el = tileRef.current?.querySelector('video')
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

function Controls({
  view,
  onView,
  fullscreen,
  onFullscreen,
}: {
  view: View
  onView: (v: View) => void
  fullscreen: boolean
  onFullscreen: () => void
}) {
  return (
    <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3">
      <TrackToggle source={Track.Source.Microphone} className={toggleClass}>
        <Mic className="size-4" aria-hidden />
        <span className="sr-only">microphone</span>
      </TrackToggle>
      <TrackToggle source={Track.Source.Camera} className={toggleClass}>
        <Video className="size-4" aria-hidden />
        <span className="sr-only">camera</span>
      </TrackToggle>
      <TrackToggle source={Track.Source.ScreenShare} className={toggleClass}>
        <MonitorUp className="size-4" aria-hidden />
        <span className="sr-only">share screen</span>
      </TrackToggle>
      <button
        onClick={() => onView(view === 'grid' ? 'speaker' : 'grid')}
        aria-label={view === 'grid' ? 'speaker view' : 'grid view'}
        aria-pressed={view === 'speaker'}
        title={view === 'grid' ? 'speaker view' : 'grid view'}
        className={toggleClass}
      >
        {view === 'grid' ? (
          <UserRound className="size-4" aria-hidden />
        ) : (
          <LayoutGrid className="size-4" aria-hidden />
        )}
      </button>
      <button
        onClick={onFullscreen}
        aria-label={fullscreen ? 'exit fullscreen' : 'fullscreen'}
        aria-pressed={fullscreen}
        title={fullscreen ? 'exit fullscreen' : 'fullscreen'}
        className={toggleClass}
      >
        {fullscreen ? (
          <Minimize className="size-4" aria-hidden />
        ) : (
          <Maximize className="size-4" aria-hidden />
        )}
      </button>
      <DisconnectButton
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2',
          'text-sm font-medium text-destructive hover:bg-destructive/10',
        )}
      >
        <PhoneOff className="size-4" aria-hidden />
        <span className="sr-only">disconnect</span>
      </DisconnectButton>
    </div>
  )
}
