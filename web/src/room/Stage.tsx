import {
  DisconnectButton,
  isTrackReference,
  LiveKitRoom,
  RoomAudioRenderer,
  TrackToggle,
  useIsSpeaking,
  useRoomContext,
  useTracks,
  VideoTrack,
} from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import {
  isE2EESupported,
  MediaDeviceFailure,
  ParticipantEvent,
  RemoteAudioTrack,
  RoomEvent,
  Track,
} from 'livekit-client'
import type {
  ConnectionState,
  Participant,
  RemoteParticipant,
  Room,
} from 'livekit-client'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  LayoutGrid,
  LoaderCircle,
  Lock,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  Phone,
  PhoneOff,
  PictureInPicture2,
  Settings,
  SignalLow,
  UserRound,
  Video,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { playSound } from '../lib/soundboard'
import Soundboard from './Soundboard'
import { gridLayout } from '../lib/grid'
import { useElementSize } from '../lib/useElementSize'
import { useRegisterStats } from '../lib/stats'
import { BINDS_CHANGED, isTextTarget, loadBinds, matchBind } from '../lib/keybinds'
import { anchor } from '../lib/popover'
import { roomOptions } from '../lib/roomopts'
import type { StatRow, StatSection } from '../lib/stats'
import type { LiveKitGrant, Peer } from '../lib/types'
import Avatar from '../components/Avatar'

type TrackRef = TrackReferenceOrPlaceholder
type View = 'grid' | 'speaker'

// how far a remote participant can be boosted above unity. the webaudio
// gain path in livekit applies the value directly so >1 actually amplifies
const MAX_BOOST = 2

// memoized at the room boundary: parent state churn like the chat badge
// or the copy button should not re-render the whole media tree
function Stage({
  grant,
  e2eeKey,
  onDebug,
  debugOpen,
  compact,
  onSound,
  peers,
  selfAvatar,
  lkRoom,
}: {
  grant: LiveKitGrant
  e2eeKey?: string | null
  onDebug?: (() => void) | undefined
  debugOpen?: boolean | undefined
  // compact collapses the stage to a tile strip so chat keeps the
  // screen on small viewports, the parent decides when to apply it
  compact?: boolean | undefined
  // fired with the pad label so chat can log the play
  onSound?: ((label: string) => void) | undefined
  // mesh roster for matching avatars to participant names, plus the
  // local profile avatar for the self tile
  peers?: Peer[] | undefined
  selfAvatar?: string | undefined
  // a caller-owned Room so chat can share the sfu connection
  lkRoom?: Room | undefined
}) {
  // the key arrives via URL fragment and is set once, it never reaches the
  // server. webAudioMix routes remote tracks through sdk-managed gain
  // nodes so per participant volume can go above 100 percent. browsers
  // without insertable streams cannot do e2ee and fall back to dtls-srtp
  // rather than failing the whole room
  const e2eeUsable = Boolean(e2eeKey) && isE2EESupported()
  const options = useMemo(() => roomOptions(e2eeKey), [e2eeKey])

  // terminate the e2ee worker on unmount
  useEffect(() => {
    return () => {
      const enc = options.encryption
      if (enc && 'worker' in enc) enc.worker.terminate()
    }
  }, [options])

  return (
    <LiveKitRoom
      serverUrl={grant.url}
      token={grant.token}
      connect
      video={false}
      {...(lkRoom ? { room: lkRoom } : { options })}
      className="flex h-full flex-col"
    >
      {e2eeKey && !e2eeUsable && (
        <p
          role="alert"
          className="flex items-center justify-center gap-1.5 border-b border-border bg-card py-1 font-mono text-[10px] text-destructive"
        >
          <Lock className="size-3" aria-hidden />
          this browser cannot do media e2ee; media is dtls-srtp only
        </p>
      )}
      <StageInner
        serverUrl={grant.url}
        token={grant.token}
        onDebug={onDebug}
        debugOpen={debugOpen}
        compact={compact}
        onSound={onSound}
        peers={peers}
        selfAvatar={selfAvatar}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

export default memo(Stage)

function fmtKbps(
  bytes: number,
  prev: { bytes: number; ts: number } | undefined,
  ts: number,
) {
  if (!prev || ts <= prev.ts) return '0'
  return String(Math.max(0, Math.round(((bytes - prev.bytes) * 8) / (ts - prev.ts))))
}

function StageInner({
  serverUrl,
  token,
  onDebug,
  debugOpen,
  compact,
  onSound,
  peers,
  selfAvatar,
}: {
  serverUrl: string
  token: string
  onDebug?: (() => void) | undefined
  debugOpen?: boolean | undefined
  onSound?: ((label: string) => void) | undefined
  compact?: boolean | undefined
  peers?: Peer[] | undefined
  selfAvatar?: string | undefined
}) {
  const room = useRoomContext()
  const tracks = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  const [view, setView] = useState<View>('grid')
  const [fullscreen, setFullscreen] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [roomState, setRoomState] = useState<ConnectionState>(room.state)
  // a disconnect only deserves an alarm after a session existed
  const [wasConnected, setWasConnected] = useState(room.state === 'connected')
  const [ptt, setPtt] = useState(() => localStorage.getItem('qc-ptt') === '1')
  const [talking, setTalking] = useState(false)
  const [saver, setSaver] = useState(() => localStorage.getItem('qc-saver') === '1')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('qc-devices') ?? '{}') as Record<
        string,
        string
      >
    } catch {
      return {}
    }
  })
  // livekit tiles know names but not avatars, the mesh roster does, so
  // match by display name and fall back to initials
  const avatarFor = (p: { isLocal: boolean; name?: string; identity: string }) => {
    if (p.isLocal) return selfAvatar
    const name = p.name || p.identity
    return peers?.find((peer) => peer.name === name)?.avatar
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const [gridRef, gridSize] = useElementSize<HTMLDivElement>()
  const prevBytes = useRef(new Map<string, { bytes: number; ts: number }>())

  // a screen share promotes the stage to speaker view when it appears,
  // the same way meet pins a presentation. switching back to grid is
  // sticky: the share only auto promotes on a fresh transition
  const hasScreen = tracks.some((t) => t.source === Track.Source.ScreenShare)
  const prevScreen = useRef(false)
  useEffect(() => {
    if (hasScreen && !prevScreen.current) setView('speaker')
    prevScreen.current = hasScreen
  }, [hasScreen])

  // per participant output volume, 0 to MAX_BOOST, keyed by identity
  const [volumes, setVolumes] = useState<Record<string, number>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('qc-volumes') ?? '{}')
      if (typeof raw !== 'object' || raw === null) return {}
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
          (e): e is [string, number] =>
            typeof e[1] === 'number' &&
            Number.isFinite(e[1]) &&
            e[1] >= 0 &&
            e[1] <= MAX_BOOST,
        ),
      )
    } catch {
      return {}
    }
  })
  const volumesRef = useRef(volumes)
  useEffect(() => {
    volumesRef.current = volumes
    localStorage.setItem('qc-volumes', JSON.stringify(volumes))
  }, [volumes])

  const setVolume = useCallback((identity: string, v: number) => {
    setVolumes((prev) => ({ ...prev, [identity]: Math.min(MAX_BOOST, Math.max(0, v)) }))
  }, [])

  // apply volume map to every remote audio track
  useEffect(() => {
    const apply = (p: RemoteParticipant) => {
      const v = volumesRef.current[p.identity] ?? 1
      for (const pub of p.audioTrackPublications.values()) {
        const t = pub.track
        if (t instanceof RemoteAudioTrack) t.setVolume(v)
      }
    }
    for (const p of room.remoteParticipants.values()) apply(p)
    const onSub = (_t: unknown, _pub: unknown, p: RemoteParticipant) => apply(p)
    const onJoin = (p: RemoteParticipant) => apply(p)
    room.on(RoomEvent.TrackSubscribed, onSub)
    room.on(RoomEvent.ParticipantConnected, onJoin)
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSub)
      room.off(RoomEvent.ParticipantConnected, onJoin)
    }
  }, [room, volumes])

  // resume the shared audio context on the first gesture inside the stage,
  // browsers start it suspended when it was created before interaction.
  // retries until playback actually starts then removes itself
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const resume = () => {
      void room
        .startAudio()
        .then(() => {
          el.removeEventListener('pointerdown', resume)
          el.removeEventListener('keydown', resume)
        })
        .catch(() => {})
    }
    el.addEventListener('pointerdown', resume)
    el.addEventListener('keydown', resume)
    return () => {
      el.removeEventListener('pointerdown', resume)
      el.removeEventListener('keydown', resume)
    }
  }, [room])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // livekit reconnects on its own, the banner just makes that visible
  useEffect(() => {
    const on = (s: ConnectionState) => {
      if (s === 'connected') setWasConnected(true)
      setRoomState(s)
    }
    room.on(RoomEvent.ConnectionStateChanged, on)
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, on)
    }
  }, [room])

  // keep the device list fresh so the settings menu can offer real
  // hardware, labels populate after first permission grant
  useEffect(() => {
    let live = true
    const load = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => {
          if (live) setDevices(d)
        })
        .catch(() => {})
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      live = false
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [])

  // in ptt mode the mic stays muted until the hold button or space bar
  // is pressed, and the same effect re-asserts mute after a reconnect
  useEffect(() => {
    if (!ptt || roomState !== 'connected') return
    void room.localParticipant.setMicrophoneEnabled(talking).catch(() => {})
  }, [ptt, talking, roomState, room])

  // space holds talk while ptt is on, never while typing
  useEffect(() => {
    if (!ptt) return
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.code !== 'Space') return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      e.preventDefault()
      setTalking(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setTalking(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [ptt])

  // data saver caps publish bitrates; reapply whenever a track appears
  // so late camera or share starts inherit the cap
  useEffect(() => {
    const apply = () => {
      const cap = (
        track: { sender: RTCRtpSender | undefined } | undefined | null,
        bitrate: number,
        fps?: number,
      ) => {
        const sender = track?.sender
        if (!sender) return
        try {
          const params = sender.getParameters()
          for (const enc of params.encodings) {
            if (saver) {
              enc.maxBitrate = bitrate
              if (fps) enc.maxFramerate = fps
            } else {
              delete enc.maxBitrate
              delete enc.maxFramerate
            }
          }
          void sender.setParameters(params).catch(() => {})
        } catch {
          // sender not ready yet, next publish event retries
        }
      }
      for (const pub of room.localParticipant.videoTrackPublications.values()) {
        cap(pub.track, 300_000, 15)
      }
      for (const pub of room.localParticipant.audioTrackPublications.values()) {
        cap(pub.track, 32_000)
      }
    }
    apply()
    room.on(RoomEvent.LocalTrackPublished, apply)
    return () => {
      room.off(RoomEvent.LocalTrackPublished, apply)
    }
  }, [room, saver])

  // restore saved device picks once the session is up
  const chosenRef = useRef(chosen)
  useEffect(() => {
    if (roomState !== 'connected') return
    for (const [kind, id] of Object.entries(chosenRef.current)) {
      void room.switchActiveDevice(kind as MediaDeviceKind, id).catch(() => {})
    }
  }, [roomState, room])

  const onDevice = (kind: MediaDeviceKind, id: string) => {
    const next = { ...chosen, [kind]: id }
    setChosen(next)
    chosenRef.current = next
    localStorage.setItem('qc-devices', JSON.stringify(next))
    void room.switchActiveDevice(kind, id).catch(() => {})
  }

  const togglePtt = () => {
    const next = !ptt
    setPtt(next)
    localStorage.setItem('qc-ptt', next ? '1' : '0')
    if (!next && roomState === 'connected') {
      void room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
    }
  }

  const toggleSaver = () => {
    const next = !saver
    setSaver(next)
    localStorage.setItem('qc-saver', next ? '1' : '0')
  }

  // soundboard pads publish a temp audio track and report the label
  // back to chat so the play shows up in the log
  const onPad = useCallback(
    (buf: AudioBuffer, label: string) => {
      void playSound(room, buf)
        .then(() => onSound?.(label))
        .catch(() => {})
    },
    [room, onSound],
  )

  useEffect(() => {
    const onErr = (err: Error, kind?: MediaDeviceKind) => {
      const what =
        kind === 'audioinput'
          ? 'microphone'
          : kind === 'videoinput'
            ? 'camera'
            : 'screen share'
      const failure = MediaDeviceFailure.getFailure(err)
      const why =
        failure === MediaDeviceFailure.PermissionDenied
          ? 'permission denied. allow access in the browser site settings and retry'
          : failure === MediaDeviceFailure.NotFound
            ? 'no device found'
            : failure === MediaDeviceFailure.DeviceInUse
              ? 'device is in use by another app'
              : err.message || 'unavailable'
      setMediaError(`${what} failed: ${why}`)
    }
    room.on(RoomEvent.MediaDevicesError, onErr)
    return () => {
      room.off(RoomEvent.MediaDevicesError, onErr)
    }
  }, [room])

  // editable keybinds toggle mic, camera, and screen share
  useEffect(() => {
    let binds = loadBinds()
    const reload = () => {
      binds = loadBinds()
    }
    const onKey = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return
      const lp = room.localParticipant
      if (matchBind(e, binds.mic)) {
        e.preventDefault()
        void lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
      } else if (matchBind(e, binds.camera)) {
        e.preventDefault()
        void lp.setCameraEnabled(!lp.isCameraEnabled)
      } else if (matchBind(e, binds.share)) {
        e.preventDefault()
        void lp.setScreenShareEnabled(!lp.isScreenShareEnabled)
      }
    }
    window.addEventListener(BINDS_CHANGED, reload)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(BINDS_CHANGED, reload)
      window.removeEventListener('keydown', onKey)
    }
  }, [room])

  // media stats feed for the debug panel
  useRegisterStats('media', async (): Promise<StatSection | null> => {
    const seen = new Set<string>()
    const rows: StatRow[] = [
      { label: 'server', value: serverUrl.replace(/^wss?:\/\//, '') },
      {
        label: 'state',
        value: room.state,
        tone: room.state === 'connected' ? 'ok' : 'warn',
      },
      {
        label: 'encryption',
        value: room.isE2EEEnabled ? 'e2ee' : 'dtls-srtp',
        tone: 'ok',
      },
    ]
    const groups: NonNullable<StatSection['groups']> = []
    const self = room.localParticipant
    const localRows: StatRow[] = []
    for (const pub of self.trackPublications.values()) {
      const t = pub.track
      if (!t || !('sender' in t) || !t.sender?.getStats) continue
      try {
        const report = await t.sender.getStats()
        report.forEach((v) => {
          if (v.type !== 'outbound-rtp') return
          const key = `out-${v.id}`
          seen.add(key)
          const prev = prevBytes.current.get(key)
          const kbps = fmtKbps(Number(v.bytesSent ?? 0), prev, v.timestamp)
          prevBytes.current.set(key, { bytes: v.bytesSent, ts: v.timestamp })
          localRows.push({ label: `${pub.source} up`, value: `${kbps} kbps` })
        })
      } catch {
        // closed sender mid poll
      }
    }
    if (localRows.length)
      groups.push({ heading: `${self.name || self.identity} (you)`, rows: localRows })

    for (const p of room.remoteParticipants.values()) {
      const prows: StatRow[] = [
        {
          label: 'quality',
          value: p.connectionQuality,
          tone:
            p.connectionQuality === 'excellent'
              ? 'ok'
              : p.connectionQuality === 'poor'
                ? 'bad'
                : 'warn',
        },
      ]
      const volume = volumesRef.current[p.identity] ?? 1
      if (volume !== 1)
        prows.push({ label: 'volume', value: `${Math.round(volume * 100)}%` })
      for (const pub of p.trackPublications.values()) {
        const t = pub.track
        if (!t?.receiver?.getStats) continue
        try {
          const report = await t.receiver.getStats()
          report.forEach((v) => {
            if (
              v.type === 'candidate-pair' &&
              v.nominated &&
              typeof v.currentRoundTripTime === 'number'
            ) {
              const ms = Math.round(v.currentRoundTripTime * 1000)
              prows.push({
                label: 'rtt',
                value: `${ms} ms`,
                tone: ms < 150 ? 'ok' : ms < 400 ? 'warn' : 'bad',
              })
            }
            if (v.type !== 'inbound-rtp') return
            const key = `in-${v.id}`
            seen.add(key)
            const prev = prevBytes.current.get(key)
            const kbps = fmtKbps(Number(v.bytesReceived ?? 0), prev, v.timestamp)
            prevBytes.current.set(key, { bytes: v.bytesReceived, ts: v.timestamp })
            const lost = Number(v.packetsLost ?? 0)
            const got = Number(v.packetsReceived ?? 0)
            const lossPct = got + lost > 0 ? (lost / (got + lost)) * 100 : 0
            prows.push({
              label: `${pub.source}`,
              value: `${kbps} kbps`,
            })
            if (v.kind === 'audio') {
              prows.push({
                label: 'jitter',
                value: `${Math.round(Number(v.jitter ?? 0) * 1000)} ms`,
                tone: Number(v.jitter ?? 0) < 0.03 ? 'ok' : 'warn',
              })
              prows.push({
                label: 'loss',
                value: `${lossPct.toFixed(1)}%`,
                tone: lossPct < 1 ? 'ok' : lossPct < 5 ? 'warn' : 'bad',
              })
            } else {
              const res =
                v.frameWidth && v.frameHeight
                  ? `${v.frameWidth}x${v.frameHeight}@${Math.round(v.framesPerSecond ?? 0)}`
                  : ''
              if (res) prows.push({ label: 'video', value: res })
            }
            const codec = v.codecId ? report.get(v.codecId) : undefined
            if (codec?.mimeType)
              prows.push({ label: 'codec', value: codec.mimeType.split('/')[1] })
          })
        } catch {
          // closed receiver mid poll
        }
      }
      groups.push({ heading: p.name || p.identity, rows: prows })
    }
    // drop byte counters for tracks that vanished so the map cannot grow
    for (const k of prevBytes.current.keys())
      if (!seen.has(k)) prevBytes.current.delete(k)
    return { title: 'livekit media', rows, groups }
  })

  // speaker view pins the screenshare or the first tile large
  const featured =
    view === 'speaker'
      ? (tracks.find((t) => t.source === Track.Source.ScreenShare) ?? tracks[0])
      : undefined
  const rest = featured ? tracks.filter((t) => t !== featured) : tracks

  // the grid computes a column count and tile size that fits every tile
  // inside the measured stage area. tiles shrink to fit, the stage never
  // scrolls
  const grid = gridLayout(tracks.length, gridSize.width, gridSize.height)

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col bg-background">
      {roomState !== 'connected' && (roomState !== 'disconnected' || wasConnected) && (
        <div
          role="status"
          className={cn(
            'flex items-center gap-2 border-b border-border bg-card px-4 py-1.5 text-xs',
            roomState === 'disconnected'
              ? 'text-destructive'
              : roomState === 'connecting'
                ? 'text-muted-foreground'
                : 'text-warning',
          )}
        >
          {roomState === 'disconnected' ? (
            <WifiOff className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
          )}
          {roomState === 'connecting'
            ? 'connecting to voice and video'
            : roomState === 'disconnected'
              ? 'disconnected from voice and video'
              : 'media connection lost, reconnecting'}
        </div>
      )}
      {mediaError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 truncate">{mediaError}</span>
          <button
            onClick={() => setMediaError('')}
            aria-label="dismiss media error"
            className="rounded-md p-0.5 hover:bg-destructive/20"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <div ref={gridRef} className={cn('min-h-0 flex-1', compact ? 'p-2' : 'p-3 sm:p-4')}>
        {tracks.length === 0 ? (
          compact ? (
            <p className="flex items-center gap-2 py-1 text-xs text-dim">
              <UserRound className="size-4 shrink-0" aria-hidden />
              nobody here yet, share the link
            </p>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-14 items-center justify-center rounded-full border border-border bg-card">
                <UserRound className="size-6 text-muted-foreground" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">
                nobody here yet. share the link.
              </p>
            </div>
          )
        ) : featured ? (
          <div className="flex h-full flex-col gap-3">
            <div className="min-h-0 flex-1">
              <Tile
                track={featured}
                avatar={avatarFor(featured.participant)}
                featured
                volume={volumes[featured.participant.identity] ?? 1}
                onVolume={
                  featured.participant.isLocal
                    ? undefined
                    : (v) => setVolume(featured.participant.identity, v)
                }
              />
            </div>
            {rest.length > 0 && (
              <div className="qc-scroll flex gap-3 overflow-x-auto pb-1">
                {rest.map((t) => (
                  <Tile
                    key={`${t.participant.identity}-${t.source}`}
                    track={t}
                    avatar={avatarFor(t.participant)}
                    strip
                    volume={volumes[t.participant.identity] ?? 1}
                    onVolume={
                      t.participant.isLocal
                        ? undefined
                        : (v) => setVolume(t.participant.identity, v)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ) : compact ? (
          // compact mode: a single horizontally scrollable tile strip
          // keeps the stage slim instead of squeezing a grid
          <div className="qc-scroll flex gap-2 overflow-x-auto pb-1">
            {tracks.map((t) => (
              <Tile
                key={`${t.participant.identity}-${t.source}`}
                track={t}
                avatar={avatarFor(t.participant)}
                strip
                volume={volumes[t.participant.identity] ?? 1}
                onVolume={
                  t.participant.isLocal
                    ? undefined
                    : (v) => setVolume(t.participant.identity, v)
                }
              />
            ))}
          </div>
        ) : (
          <div
            className="grid h-full w-full place-content-center gap-3"
            style={{
              gridTemplateColumns:
                grid.tileW > 0
                  ? `repeat(${grid.cols}, ${Math.floor(grid.tileW)}px)`
                  : `repeat(${grid.cols}, minmax(0, 1fr))`,
            }}
          >
            {tracks.map((t) => (
              <Tile
                key={`${t.participant.identity}-${t.source}`}
                track={t}
                avatar={avatarFor(t.participant)}
                volume={volumes[t.participant.identity] ?? 1}
                onVolume={
                  t.participant.isLocal
                    ? undefined
                    : (v) => setVolume(t.participant.identity, v)
                }
              />
            ))}
          </div>
        )}
      </div>
      <Controls
        view={view}
        onView={setView}
        fullscreen={fullscreen}
        onFullscreen={() => {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
          else void rootRef.current?.requestFullscreen().catch(() => {})
        }}
        onDebug={onDebug}
        debugOpen={debugOpen}
        disconnected={roomState === 'disconnected'}
        onReconnect={() => {
          void room.connect(serverUrl, token).catch(() => {})
        }}
        ptt={ptt}
        talking={talking}
        onTalk={setTalking}
        onPtt={togglePtt}
        saver={saver}
        onSaver={toggleSaver}
        devices={devices}
        chosen={chosen}
        onDevice={onDevice}
        onPad={onPad}
        connected={roomState === 'connected'}
      />
    </div>
  )
}

// livekit recomputes connection quality continuously, subscribe so a
// degrading link is visible on the tile instead of only in the debug
// panel
function useConnectionQuality(p: Participant) {
  const [q, setQ] = useState(p.connectionQuality)
  useEffect(() => {
    const on = () => setQ(p.connectionQuality)
    p.on(ParticipantEvent.ConnectionQualityChanged, on)
    return () => {
      p.off(ParticipantEvent.ConnectionQualityChanged, on)
    }
  }, [p])
  return q
}

function Tile({
  track,
  featured,
  strip,
  avatar,
  volume,
  onVolume,
}: {
  track: TrackRef
  featured?: boolean | undefined
  strip?: boolean | undefined
  avatar?: string | undefined
  volume?: number | undefined
  onVolume?: ((v: number) => void) | undefined
}) {
  const speaking = useIsSpeaking(track.participant)
  const quality = useConnectionQuality(track.participant)
  const isScreen = track.source === Track.Source.ScreenShare
  const hasVideo = isTrackReference(track)
  const tileRef = useRef<HTMLDivElement>(null)
  const [pip, setPip] = useState(false)
  const [volOpen, setVolOpen] = useState(false)
  const [volPos, setVolPos] = useState<ReturnType<typeof anchor> | null>(null)
  const volBtnRef = useRef<HTMLButtonElement>(null)

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
  }, [hasVideo, track])

  // close the volume popup when the pointer lands outside the tile
  useEffect(() => {
    if (!volOpen) return
    const close = (e: PointerEvent) => {
      if (!tileRef.current?.contains(e.target as Node)) setVolOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [volOpen])

  return (
    <div
      ref={tileRef}
      className={cn(
        'group relative aspect-video w-full overflow-hidden rounded-lg border bg-recessed transition-colors',
        featured && 'h-full w-full',
        strip && 'w-40 shrink-0',
        speaking ? 'border-success' : 'border-border',
      )}
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={track}
          className={cn('h-full w-full', isScreen ? 'object-contain' : 'object-cover')}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Avatar
            name={track.participant.name || track.participant.identity || '?'}
            avatar={avatar}
            className="size-14 rounded-full border-border-strong bg-card text-lg font-semibold"
          />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-0.5 backdrop-blur-sm">
        <span className="max-w-32 truncate text-xs font-medium text-foreground">
          {track.participant.name || track.participant.identity}
        </span>
        {!track.participant.isMicrophoneEnabled && (
          <MicOff className="size-3 text-destructive" aria-label="muted" />
        )}
        {quality === 'poor' && (
          <SignalLow className="size-3 text-warning" aria-label="poor connection" />
        )}
        {quality === 'lost' && (
          <WifiOff className="size-3 text-destructive" aria-label="connection lost" />
        )}
        {isScreen && <MonitorUp className="size-3 text-muted-foreground" />}
      </div>
      <div
        className={cn(
          'absolute right-2 top-2 flex gap-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
          volOpen ? 'opacity-100' : 'opacity-0',
        )}
      >
        {onVolume && !isScreen && (
          <div>
            <button
              ref={volBtnRef}
              aria-label={`volume ${Math.round((volume ?? 1) * 100)} percent`}
              aria-expanded={volOpen}
              title="volume"
              onClick={() => {
                // fixed positioning escapes the tile overflow clip, the
                // shared anchor flips it below the button near the top edge
                if (!volOpen && volBtnRef.current)
                  setVolPos(anchor(volBtnRef.current, 90))
                setVolOpen(!volOpen)
              }}
              className="rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-foreground"
            >
              {(volume ?? 1) === 0 ? (
                <VolumeX className="size-3.5" aria-hidden />
              ) : (
                <Volume2 className="size-3.5" aria-hidden />
              )}
            </button>
            {volOpen && volPos && (
              <div
                style={volPos}
                className="fixed z-50 flex w-36 flex-col gap-1.5 rounded-md border border-border bg-card p-2 shadow-md"
              >
                <input
                  type="range"
                  min={0}
                  max={MAX_BOOST * 100}
                  step={5}
                  value={Math.round((volume ?? 1) * 100)}
                  onChange={(e) => onVolume(Number(e.target.value) / 100)}
                  aria-label="participant volume"
                  className="w-full accent-foreground"
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{Math.round((volume ?? 1) * 100)}%</span>
                  <button
                    onClick={() => onVolume(1)}
                    className="rounded px-1 hover:bg-hover hover:text-foreground"
                  >
                    reset
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {hasVideo && document.pictureInPictureEnabled && (
          <button
            aria-label="picture in picture"
            aria-pressed={pip}
            title="picture in picture"
            onClick={() => {
              const el = tileRef.current?.querySelector('video')
              if (!el) return
              if (document.pictureInPictureElement === el)
                void document.exitPictureInPicture().catch(() => {})
              else void el.requestPictureInPicture().catch(() => {})
            }}
            className="rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-foreground"
          >
            <PictureInPicture2 className="size-3.5" aria-hidden />
          </button>
        )}
        <button
          aria-label="fullscreen tile"
          title="fullscreen tile"
          onClick={() => {
            void tileRef.current?.requestFullscreen().catch(() => {})
          }}
          className="rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-foreground"
        >
          <Maximize className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

const toggleClass = cn(
  'flex items-center gap-2 rounded-full px-3 py-2',
  'text-sm font-medium text-muted-foreground hover:bg-hover hover:text-foreground',
  'aria-pressed:bg-hover aria-pressed:text-emphasis',
)

function Controls({
  view,
  onView,
  fullscreen,
  onFullscreen,
  onDebug,
  debugOpen,
  disconnected,
  onReconnect,
  ptt,
  talking,
  onTalk,
  onPtt,
  saver,
  onSaver,
  devices,
  chosen,
  onDevice,
  onPad,
  connected,
}: {
  view: View
  onView: (v: View) => void
  fullscreen: boolean
  onFullscreen: () => void
  onDebug?: (() => void) | undefined
  debugOpen?: boolean | undefined
  disconnected?: boolean | undefined
  onReconnect?: (() => void) | undefined
  ptt?: boolean | undefined
  talking?: boolean | undefined
  onTalk?: ((on: boolean) => void) | undefined
  onPtt?: (() => void) | undefined
  saver?: boolean | undefined
  onSaver?: (() => void) | undefined
  devices?: MediaDeviceInfo[] | undefined
  chosen?: Record<string, string> | undefined
  onDevice?: ((kind: MediaDeviceKind, id: string) => void) | undefined
  onPad?: ((buf: AudioBuffer, label: string) => void) | undefined
  connected?: boolean | undefined
}) {
  return (
    <div className="flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="relative flex flex-wrap items-center justify-center gap-0.5 rounded-full border border-border bg-card px-2 py-1.5 shadow-lg">
        {ptt ? (
          <button
            onPointerDown={() => onTalk?.(true)}
            onPointerUp={() => onTalk?.(false)}
            onPointerLeave={() => onTalk?.(false)}
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={talking}
            aria-label="hold to talk"
            title="hold to talk (or hold space)"
            className={cn(
              toggleClass,
              'select-none touch-none',
              talking && 'border-success text-success',
            )}
          >
            <Mic className="size-4" aria-hidden />
            <span className="hidden sm:inline">hold to talk</span>
          </button>
        ) : (
          <TrackToggle source={Track.Source.Microphone} className={toggleClass}>
            <Mic className="size-4" aria-hidden />
            <span className="sr-only">microphone</span>
          </TrackToggle>
        )}
        <TrackToggle source={Track.Source.Camera} className={toggleClass}>
          <Video className="size-4" aria-hidden />
          <span className="sr-only">camera</span>
        </TrackToggle>
        <TrackToggle
          source={Track.Source.ScreenShare}
          className={cn(toggleClass, 'max-sm:hidden')}
        >
          <MonitorUp className="size-4" aria-hidden />
          <span className="sr-only">share screen</span>
        </TrackToggle>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
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
        {onDebug && (
          <button
            onClick={onDebug}
            aria-label="connection stats"
            aria-pressed={debugOpen}
            title="connection stats"
            className={cn(toggleClass, 'max-sm:hidden')}
          >
            <Activity className="size-4" aria-hidden />
          </button>
        )}
        {onPad && <Soundboard onPlay={onPad} disabled={!connected} />}
        {onDevice && (
          <SettingsMenu
            devices={devices ?? []}
            chosen={chosen ?? {}}
            onDevice={onDevice}
            ptt={ptt}
            onPtt={onPtt}
            saver={saver}
            onSaver={onSaver}
          />
        )}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        {disconnected ? (
          <button
            onClick={onReconnect}
            aria-label="connect"
            title="connect"
            className={cn(toggleClass, 'text-success hover:bg-success/10')}
          >
            <Phone className="size-4" aria-hidden />
            <span className="sr-only">connect</span>
          </button>
        ) : (
          <DisconnectButton
            className={cn(toggleClass, 'text-destructive hover:bg-destructive/10')}
          >
            <PhoneOff className="size-4" aria-hidden />
            <span className="sr-only">disconnect</span>
          </DisconnectButton>
        )}
      </div>
    </div>
  )
}

function SettingsMenu({
  devices,
  chosen,
  onDevice,
  ptt,
  onPtt,
  saver,
  onSaver,
}: {
  devices: MediaDeviceInfo[]
  chosen: Record<string, string>
  onDevice: (kind: MediaDeviceKind, id: string) => void
  ptt?: boolean | undefined
  onPtt?: (() => void) | undefined
  saver?: boolean | undefined
  onSaver?: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<ReturnType<typeof anchor> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const toggle = () => {
    if (!open && btnRef.current) {
      // fixed anchoring avoids overflow-hidden clipping and keeps the
      // menu glued to the gear on every layout
      setPos(anchor(btnRef.current))
    }
    setOpen(!open)
  }
  const kinds: { kind: MediaDeviceKind; label: string }[] = [
    { kind: 'audioinput', label: 'microphone' },
    { kind: 'videoinput', label: 'camera' },
    { kind: 'audiooutput', label: 'speaker' },
  ]
  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="media settings"
        aria-expanded={open}
        title="media settings"
        className={toggleClass}
      >
        <Settings className="size-4" aria-hidden />
      </button>
      {open && pos && (
        <div
          role="dialog"
          aria-label="media settings"
          style={pos}
          className="fixed z-50 w-64 space-y-3 rounded-md border border-border bg-card p-3 shadow-md"
        >
          {kinds.map(({ kind, label }) => {
            const list = devices.filter((d) => d.kind === kind)
            return (
              <label key={kind} className="block text-xs">
                <span className="pb-1 block text-muted-foreground">{label}</span>
                <select
                  aria-label={label}
                  value={chosen[kind] ?? ''}
                  onChange={(e) => onDevice(kind, e.target.value)}
                  className="w-full rounded-md border border-border bg-recessed px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
                >
                  <option value="">default</option>
                  {list.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `${label} ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
          <div className="space-y-1.5 border-t border-border pt-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={Boolean(ptt)}
                onChange={() => onPtt?.()}
                className="accent-foreground"
              />
              push to talk
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={Boolean(saver)}
                onChange={() => onSaver?.()}
                className="accent-foreground"
              />
              data saver (lower bitrates)
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
