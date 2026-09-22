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
import { Track } from 'livekit-client'
import { Mic, MonitorUp, PhoneOff, Video } from 'lucide-react'
import { cn } from '../lib/cn'
import type { LiveKitGrant } from '../lib/types'

type TrackRef = TrackReferenceOrPlaceholder

export default function Stage({ grant }: { grant: LiveKitGrant }) {
  return (
    <LiveKitRoom
      serverUrl={grant.url}
      token={grant.token}
      connect
      audio
      video={false}
      className="flex h-full flex-col"
    >
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

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              nobody here yet. share the link.
            </p>
          </div>
        ) : (
          <div className="grid h-fit grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tracks.map((t) => (
              <Tile key={`${t.participant.identity}-${t.source}`} track={t} />
            ))}
          </div>
        )}
      </div>
      <Controls />
    </>
  )
}

function Tile({ track }: { track: TrackRef }) {
  const speaking = useIsSpeaking(track.participant)
  const isScreen = track.source === Track.Source.ScreenShare
  const hasVideo = isTrackReference(track)

  return (
    <div
      className={cn(
        'relative aspect-video overflow-hidden rounded-lg border bg-recessed',
        isScreen && 'sm:col-span-2',
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
        {!track.participant.isMicrophoneEnabled && <MicOffIcon />}
        {isScreen && <MonitorUp className="size-3 text-muted-foreground" />}
      </div>
    </div>
  )
}

function MicOffIcon() {
  return (
    <svg
      className="size-3 text-destructive"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="muted"
    >
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  )
}

const toggleClass = cn(
  'flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2',
  'text-sm font-medium text-muted-foreground hover:bg-hover hover:text-foreground',
  'aria-pressed:border-border-strong aria-pressed:text-emphasis',
)

function Controls() {
  return (
    <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3">
      <TrackToggle source={Track.Source.Microphone} className={toggleClass}>
        <Mic className="size-4" />
      </TrackToggle>
      <TrackToggle source={Track.Source.Camera} className={toggleClass}>
        <Video className="size-4" />
      </TrackToggle>
      <TrackToggle source={Track.Source.ScreenShare} className={toggleClass}>
        <MonitorUp className="size-4" />
      </TrackToggle>
      <DisconnectButton
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2',
          'text-sm font-medium text-destructive hover:bg-destructive/10',
        )}
      >
        <PhoneOff className="size-4" />
      </DisconnectButton>
    </div>
  )
}
