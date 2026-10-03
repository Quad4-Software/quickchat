import { memo, useEffect, useRef, useState } from 'react'
import {
  Copy,
  CornerUpLeft,
  FileIcon,
  Loader2,
  Pause,
  Play,
  Presentation,
  Trash2,
} from 'lucide-react'
import { fileSize, timestamp } from '../lib/format'
import { parseMd } from '../lib/markdown'
import { cn } from '../lib/cn'
import Avatar from '../components/Avatar'
import type { ChatMessage, FileRef } from '../lib/types'

const QUICK_REACTS = ['👍', '❤️', '😂', '😮', '😢']

export interface RowActions {
  onReply?: ((msg: ChatMessage) => void) | undefined
  onReact?: ((msg: ChatMessage, emoji: string) => void) | undefined
  onCopy?: ((msg: ChatMessage) => void) | undefined
  onDelete?: ((msg: ChatMessage) => void) | undefined
  onPresent?: ((msg: ChatMessage) => void) | undefined
}

// memoized so a typing tick or an unrelated message append does not
// re-render every row in the log
function MessageRow({
  msg,
  self,
  selfName,
  onReply,
  onReact,
  onCopy,
  onDelete,
  onPresent,
}: {
  msg: ChatMessage
  /** true when the local user sent this message */
  self?: boolean | undefined
  /** local display name, used to highlight own reactions */
  selfName?: string | undefined
} & RowActions) {
  if (msg.sys) {
    return (
      <p className="text-xs text-dim">
        {msg.peer.name} {msg.body}
        <span className="font-mono"> - {timestamp(msg.ts)}</span>
      </p>
    )
  }
  if (msg.deleted) {
    return (
      <p className="text-xs italic text-dim">
        {msg.peer.name} deleted a message
        <span className="font-mono"> - {timestamp(msg.ts)}</span>
      </p>
    )
  }
  const hasActions = onReply || onReact || onCopy || onDelete
  return (
    <div className="group min-w-0">
      <div className="flex items-center gap-2">
        <Avatar name={msg.peer.name} avatar={msg.peer.avatar} />
        <span className="truncate text-sm font-semibold text-emphasis">
          {msg.peer.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-dim">
          {msg.pending ? 'sending...' : timestamp(msg.ts)}
        </span>
        {hasActions && (
          <span className="ml-auto flex shrink-0 translate-y-1 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-70">
            {onReact &&
              QUICK_REACTS.map((e) => (
                <ActionBtn key={e} label={`react ${e}`} onClick={() => onReact(msg, e)}>
                  <span aria-hidden>{e}</span>
                </ActionBtn>
              ))}
            {msg.file?.mime === 'application/pdf' && onPresent && (
              <ActionBtn label="present" onClick={() => onPresent(msg)}>
                <Presentation className="size-3" aria-hidden />
              </ActionBtn>
            )}
            {onReply && (
              <ActionBtn label="reply" onClick={() => onReply(msg)}>
                <CornerUpLeft className="size-3" aria-hidden />
              </ActionBtn>
            )}
            {onCopy && msg.body && (
              <ActionBtn label="copy" onClick={() => onCopy(msg)}>
                <Copy className="size-3" aria-hidden />
              </ActionBtn>
            )}
            {self && onDelete && (
              <ActionBtn label="unsend" danger onClick={() => onDelete(msg)}>
                <Trash2 className="size-3" aria-hidden />
              </ActionBtn>
            )}
          </span>
        )}
      </div>
      {msg.reply && (
        <div className="mt-0.5 flex gap-2 border-l-2 border-border-strong pl-2 text-xs text-dim">
          <span className="shrink-0 font-medium text-muted-foreground">
            {msg.reply.name}
          </span>
          <span className="truncate">
            {msg.reply.body ?? (msg.reply.file ? `file: ${msg.reply.file}` : 'message')}
          </span>
        </div>
      )}
      {msg.body && <MdBody body={msg.body} />}
      {msg.file && <FileCard file={msg.file} />}
      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {Object.entries(msg.reactions).map(([emoji, names]) => {
            const mine = selfName ? names.includes(selfName) : false
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={mine}
                title={names.join(', ')}
                onClick={() => onReact?.(msg, emoji)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs',
                  mine
                    ? 'border-border-strong bg-hover text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-hover',
                )}
              >
                <span>{emoji}</span>
                <span className="font-mono text-[10px]">{names.length}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActionBtn({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean | undefined
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground',
        danger && 'hover:text-destructive',
      )}
    >
      {children}
    </button>
  )
}

function MdBody({ body }: { body: string }) {
  const nodes = parseMd(body)
  return (
    <p className="break-words text-sm text-foreground">
      {nodes.map((n, i) => {
        switch (n.k) {
          case 'pre':
            return (
              <span
                key={i}
                className="my-1 block overflow-x-auto whitespace-pre rounded-md border border-border bg-recessed px-2 py-1.5 font-mono text-xs"
              >
                {n.s}
              </span>
            )
          case 'code':
            return (
              <code key={i} className="rounded bg-recessed px-1 font-mono text-[13px]">
                {n.s}
              </code>
            )
          case 'bold':
            return <strong key={i}>{n.s}</strong>
          case 'ital':
            return <em key={i}>{n.s}</em>
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-dim underline-offset-2 hover:text-emphasis"
              >
                {n.s}
              </a>
            )
          default:
            return n.s
        }
      })}
    </p>
  )
}

export default memo(MessageRow)

function FileCard({ file }: { file: FileRef }) {
  if (file.failed) {
    return (
      <p className="mt-1 flex w-fit items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground">
        <FileIcon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-dim">{file.failed}</span>
      </p>
    )
  }
  if (file.url && file.mime.startsWith('image/')) {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          className="max-h-56 max-w-full rounded-md border border-border"
        />
      </a>
    )
  }
  if (file.url && file.mime === 'application/pdf') {
    return (
      <div className="mt-1 w-fit max-w-full">
        <iframe
          src={file.url}
          title={file.name}
          loading="lazy"
          className="h-44 w-72 max-w-full rounded-md border border-border bg-white"
        />
        <p className="pt-0.5 font-mono text-[10px] text-dim">
          {file.name} - {fileSize(file.size)}
        </p>
      </div>
    )
  }
  if (file.url && file.mime.startsWith('audio/')) {
    return <VoiceNote file={file} />
  }
  return (
    <a
      href={file.url}
      download={file.name}
      className="mt-1 flex w-fit items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground hover:bg-hover"
    >
      <FileIcon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{file.name}</span>
      {file.progress !== undefined ? (
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-dim">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {Math.round(file.progress * 100)}%
        </span>
      ) : (
        <span className="shrink-0 font-mono text-[10px] text-dim">
          {fileSize(file.size)}
        </span>
      )}
    </a>
  )
}

const BARS = 32

// VoiceNote decodes the blob into real rms peaks so the bar graph is
// an actual waveform, not decoration. Seeking by tap follows the play
// position.
function VoiceNote({ file }: { file: FileRef }) {
  const [peaks, setPeaks] = useState<number[]>([])
  const [dur, setDur] = useState(0)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let stop = false
    const ac = new AudioContext()
    fetch(file.url!)
      .then((r) => r.arrayBuffer())
      .then((d) => ac.decodeAudioData(d))
      .then((buf) => {
        if (stop) return
        setDur(buf.duration)
        const data = buf.getChannelData(0)
        const bucket = Math.max(1, Math.floor(data.length / BARS))
        const out: number[] = []
        for (let i = 0; i < BARS; i++) {
          let sum = 0
          const off = i * bucket
          for (let j = 0; j < bucket; j += 16) {
            const v = data[off + j] ?? 0
            sum += v * v
          }
          out.push(Math.sqrt(sum / Math.max(1, bucket / 16)))
        }
        const max = Math.max(0.01, ...out)
        setPeaks(out.map((p) => Math.max(0.12, p / max)))
      })
      .catch(() => setPeaks(Array(BARS).fill(0.4)))
      .finally(() => void ac.close())
    return () => {
      stop = true
      void ac.close().catch(() => {})
    }
  }, [file.url])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const tick = () => setT(el.currentTime)
    const end = () => setPlaying(false)
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', end)
    el.addEventListener('pause', end)
    return () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', end)
      el.removeEventListener('pause', end)
    }
  }, [])

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      void el.play().then(() => setPlaying(true))
    }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current
    if (!el || !el.duration) return
    const r = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - r.left) / r.width) * el.duration
    setT(el.currentTime)
  }

  const frac = dur ? t / dur : 0
  const lit = Math.round(frac * BARS)

  return (
    <div className="mt-1 flex w-56 items-center gap-2 rounded-2xl border border-border bg-card py-1.5 pl-1.5 pr-3">
      <audio ref={audioRef} src={file.url!} preload="metadata" />
      <button
        onClick={toggle}
        aria-label={playing ? 'pause voice message' : 'play voice message'}
        aria-pressed={playing}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-inverted text-inverted-foreground hover:opacity-90"
      >
        {playing ? (
          <Pause className="size-3.5 fill-current" aria-hidden />
        ) : (
          <Play className="size-3.5 fill-current" aria-hidden />
        )}
      </button>
      <div
        role="slider"
        aria-label="voice message position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        onClick={seek}
        className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-px"
      >
        {(peaks.length ? peaks : Array(BARS).fill(0.3)).map((p, i) => (
          <span
            key={i}
            className={cn(
              'w-[3px] shrink-0 rounded-full',
              i < lit ? 'bg-emphasis' : 'bg-muted-foreground/50',
            )}
            style={{ height: `${Math.max(4, p * 24)}px` }}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-dim">
        {dur ? `${dur.toFixed(1)}s` : ''}
      </span>
    </div>
  )
}
