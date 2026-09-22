import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  Bell,
  BellOff,
  BellRing,
  Paperclip,
  SendHorizonal,
  Users,
} from 'lucide-react'
import { Mesh, newNonce } from '../lib/mesh'
import type { ChatSession, MeshOptions } from '../lib/mesh'
import { useRegisterStats } from '../lib/stats'
import type { StatRow } from '../lib/stats'
import { activityBegin, activityEnd } from '../lib/activity'
import { SITE } from '../lib/site'
import { fileSize } from '../lib/format'
import { cn } from '../lib/cn'
import MessageRow from './MessageRow'
import type { ChatMessage, FileMeta, FileRef, Peer } from '../lib/types'

const toneForIce = (s: RTCIceConnectionState) =>
  s === 'connected' || s === 'completed'
    ? ('ok' as const)
    : s === 'failed' || s === 'disconnected'
      ? ('bad' as const)
      : ('warn' as const)

const MAX_MESSAGES = 500
// blobs live in memory only; bound total retention so a busy room can
// not grow the tab without limit
const MAX_BLOB_BYTES = 256 << 20
const TYPING_MS = 4000
const TYPING_THROTTLE_MS = 1500
const PIN_THRESHOLD_PX = 40

function bumpTitle() {
  const cur = /^\((\d+)\)/.exec(document.title)
  const n = (cur ? Number(cur[1]) : 0) + 1
  document.title = `(${n}) ${SITE.name}`
}

export default function ChatPane({
  room,
  name,
  iceServers,
  maxFileSize,
  createSession,
}: {
  room: string
  name: string
  iceServers: string[]
  maxFileSize: number
  // defaults to the real webrtc mesh; demo mode injects a scripted one
  createSession?: (opts: MeshOptions) => ChatSession
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [typing, setTyping] = useState<Peer[]>([])
  const [connected, setConnected] = useState(false)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [body, setBody] = useState('')
  const [notify, setNotify] = useState<NotificationPermission>(() =>
    'Notification' in window ? Notification.permission : 'denied',
  )

  const meshRef = useRef<ChatSession | null>(null)
  const selfRef = useRef<Peer>({ id: 'me', name })

  // per-peer p2p link stats for the debug panel
  useRegisterStats('p2p mesh', async () => {
    const rows: StatRow[] = [
      {
        label: 'signaling',
        value: connected ? 'online' : 'reconnecting',
        tone: connected ? 'ok' : 'warn',
      },
      { label: 'peers', value: String(peers.length) },
    ]
    const groups: { heading: string; rows: StatRow[] }[] = []
    const m = meshRef.current
    if (m?.stats) {
      for (const s of await m.stats()) {
        groups.push({
          heading: s.peer.name,
          rows: [
            {
              label: 'rtt',
              value: s.rttMs == null ? '-' : `${s.rttMs} ms`,
              tone:
                s.rttMs == null
                  ? 'warn'
                  : s.rttMs < 150
                    ? 'ok'
                    : s.rttMs < 500
                      ? 'warn'
                      : 'bad',
            },
            { label: 'ice', value: s.iceState, tone: toneForIce(s.iceState) },
            { label: 'chat channel', value: s.channel },
            {
              label: 'data',
              value: `${fileSize(s.sent)} sent, ${fileSize(s.received)} recv`,
            },
          ],
        })
      }
    }
    return { title: 'p2p mesh', rows, groups }
  })
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pinnedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimers = useRef(new Map<string, number>())
  const typingSentAt = useRef(0)
  const dragDepth = useRef(0)
  const blobBytes = useRef(0)
  // per-peer upload progress: msgId -> peerId -> ratio sent
  const upProgress = useRef(new Map<string, Map<string, number>>())
  // msgIds with an in-flight download, for the pwa update guard
  const activeDown = useRef(new Set<string>())

  function downDone(msgId: string) {
    if (activeDown.current.delete(msgId)) activityEnd()
  }
  // files can finish before their chat message arrives when channels
  // race: fileId -> completed blob with its url, or a failure reason
  const doneFiles = useRef(new Map<string, { blob: Blob; url: string } | string>())

  function updateUpProgress(msgId: string) {
    const per = upProgress.current.get(msgId)
    if (!per || per.size === 0) {
      upProgress.current.delete(msgId)
      mutateFile(msgId, (f) => ({ ...f, progress: undefined }))
      return
    }
    const min = Math.min(...per.values())
    if (min >= 1) {
      upProgress.current.delete(msgId)
      mutateFile(msgId, (f) => ({ ...f, progress: undefined }))
    } else {
      mutateFile(msgId, (f) => ({ ...f, progress: min }))
    }
  }

  // incomingFile builds FileRef for a received file announcement, picking
  // up a blob or failure if the transfer already finished out of order
  function incomingFile(meta: FileMeta): FileRef {
    const done = doneFiles.current.get(meta.id)
    if (typeof done === 'object') {
      return { ...meta, blob: done.blob, url: done.url }
    }
    if (typeof done === 'string') {
      return { ...meta, failed: done }
    }
    return { ...meta, progress: 0 }
  }

  function revokeFile(f?: FileRef) {
    if (f?.url) {
      URL.revokeObjectURL(f.url)
      blobBytes.current -= f.size
    }
  }

  function appendMessage(msg: ChatMessage) {
    setMessages((prev) => {
      const next = [...prev.slice(-MAX_MESSAGES + 1), msg]
      const kept = new Set(next.map((m) => m.id))
      for (const m of prev) if (!kept.has(m.id)) revokeFile(m.file)
      return next
    })
  }

  function mutateFile(msgId: string, fn: (f: FileRef) => FileRef) {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId && m.file ? { ...m, file: fn(m.file) } : m)),
    )
  }

  useEffect(() => {
    const mesh = (createSession ?? ((o: MeshOptions) => new Mesh(o)))({
      room,
      name,
      iceServers,
      maxFileBytes: maxFileSize,
      handlers: {
        onWelcome(self, roster) {
          selfRef.current = self
          setPeers(roster)
        },
        onPeerJoined(peer) {
          setPeers((p) => (p.some((x) => x.id === peer.id) ? p : [...p, peer]))
        },
        onPeerLeft(peer) {
          setPeers((p) => p.filter((x) => x.id !== peer.id))
          setTyping((t) => t.filter((x) => x.id !== peer.id))
          // drop the departed peer from upload denominators
          const affected = [...upProgress.current.keys()].filter((k) =>
            upProgress.current.get(k)?.has(peer.id),
          )
          for (const msgId of affected) {
            upProgress.current.get(msgId)?.delete(peer.id)
            updateUpProgress(msgId)
          }
          // announced files from the departed peer that never arrived
          setMessages((prev) =>
            prev.map((m) => {
              if (m.peer.id === peer.id && m.file && !m.file.url && !m.file.failed) {
                downDone(m.id)
                return {
                  ...m,
                  file: { ...m.file, progress: undefined, failed: 'peer left' },
                }
              }
              return m
            }),
          )
        },
        onChat(ev) {
          const msg: ChatMessage = {
            id: ev.id,
            peer: ev.peer,
            ts: ev.ts,
            ...(ev.body ? { body: ev.body } : {}),
            ...(ev.file ? { file: incomingFile(ev.file) } : {}),
          }
          setMessages((prev) => {
            if (prev.some((x) => x.id === msg.id)) return prev
            const next = [...prev.slice(-MAX_MESSAGES + 1), msg]
            const kept = new Set(next.map((m) => m.id))
            for (const m of prev) if (!kept.has(m.id)) revokeFile(m.file)
            return next
          })
          if (!pinnedRef.current) setUnread((n) => n + 1)
          if (document.hidden) {
            bumpTitle()
            if (
              'Notification' in window &&
              Notification.permission === 'granted' &&
              ev.peer.id !== selfRef.current.id
            ) {
              const n = new Notification(`${ev.peer.name} - ${SITE.name}`, {
                body: ev.body ?? ev.file?.name ?? '',
                tag: ev.id,
              })
              n.onclick = () => window.focus()
            }
          }
        },
        onTyping(peer, on) {
          const timers = typingTimers.current
          window.clearTimeout(timers.get(peer.id))
          if (on) {
            timers.set(
              peer.id,
              window.setTimeout(
                () => setTyping((t) => t.filter((x) => x.id !== peer.id)),
                TYPING_MS,
              ),
            )
            setTyping((t) => (t.some((x) => x.id === peer.id) ? t : [...t, peer]))
          } else {
            setTyping((t) => t.filter((x) => x.id !== peer.id))
          }
        },
        onFileProgress(p) {
          if (p.dir === 'down') {
            if (!activeDown.current.has(p.msgId)) {
              activeDown.current.add(p.msgId)
              activityBegin()
            }
            mutateFile(p.msgId, (f) => ({ ...f, progress: p.done / p.total }))
            return
          }
          // upload side: show the slowest peer so progress means everyone
          // has at least this much
          let per = upProgress.current.get(p.msgId)
          if (!per) {
            per = new Map()
            upProgress.current.set(p.msgId, per)
          }
          per.set(p.peer.id, p.done / p.total)
          updateUpProgress(p.msgId)
        },
        onFileDone(fileId, msgId, _peer, blob) {
          downDone(msgId)
          const url = URL.createObjectURL(blob)
          blobBytes.current += blob.size
          // remember it in case the chat message lands after the file
          doneFiles.current.set(fileId, { blob, url })
          mutateFile(msgId, (f) => ({ ...f, blob, url, progress: undefined }))
        },
        onFileError(fileId, msgId, _peer, reason) {
          downDone(msgId)
          doneFiles.current.set(fileId, reason)
          mutateFile(msgId, (f) => ({ ...f, progress: undefined, failed: reason }))
        },
        onConnected: setConnected,
      },
    })
    mesh.connect()
    meshRef.current = mesh
    const timers = typingTimers.current
    return () => {
      mesh.close()
      timers.forEach((t) => window.clearTimeout(t))
    }
    // iceServers and maxFileSize are stable room config
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name])

  // object urls must outlive renders but not the session
  useEffect(() => {
    return () => {
      setMessages((prev) => {
        for (const m of prev) revokeFile(m.file)
        return prev
      })
    }
  }, [])

  // unread count in the tab title while the page is hidden
  useEffect(() => {
    const base = `${room} - ${SITE.name}`
    const reset = () => {
      if (!document.hidden) document.title = base
    }
    document.addEventListener('visibilitychange', reset)
    window.addEventListener('focus', reset)
    return () => {
      document.removeEventListener('visibilitychange', reset)
      window.removeEventListener('focus', reset)
    }
  }, [room])

  useEffect(() => {
    const el = listRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  // slash focuses the composer from anywhere in the room
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const editable =
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (e.key === '/' && !editable) {
        e.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    pinnedRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX
    if (pinnedRef.current && unread) setUnread(0)
  }

  function jumpToLatest() {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    pinnedRef.current = true
    setUnread(0)
  }

  function send() {
    const text = body.trim()
    if (!text) return
    const mesh = meshRef.current
    if (!mesh) return
    const id = mesh.broadcastChat(text)
    appendMessage({ id, peer: selfRef.current, body: text, ts: Date.now() })
    pinnedRef.current = true
    mesh.broadcastTyping(false)
    setBody('')
    resetComposerHeight()
  }

  function onBodyChange(v: string) {
    setBody(v)
    const now = Date.now()
    if (v && now - typingSentAt.current > TYPING_THROTTLE_MS) {
      typingSentAt.current = now
      meshRef.current?.broadcastTyping(true)
    }
  }

  function sendFiles(files: Iterable<File>) {
    const mesh = meshRef.current
    if (!mesh) return
    for (const f of files) {
      setError('')
      if (f.size > maxFileSize) {
        setError(`${f.name} exceeds the ${fileSize(maxFileSize)} limit`)
        continue
      }
      const meta = {
        id: newNonce(),
        name: f.name || 'file',
        size: f.size,
        mime: f.type || 'application/octet-stream',
      }
      const msgId = mesh.broadcastChat(body.trim(), meta)
      const url = URL.createObjectURL(f)
      blobBytes.current += f.size
      appendMessage({
        id: msgId,
        peer: selfRef.current,
        ts: Date.now(),
        ...(body.trim() ? { body: body.trim() } : {}),
        file: { ...meta, blob: f, url },
      })
      pinnedRef.current = true
      mesh.sendFile(f, meta, msgId)
    }
    setBody('')
    resetComposerHeight()
    if (fileRef.current) fileRef.current.value = ''
    // trim memory if retention cap exceeded
    setMessages((prev) => {
      let bytes = blobBytes.current
      if (bytes <= MAX_BLOB_BYTES) return prev
      const next = prev.slice()
      for (let i = 0; i < next.length && bytes > MAX_BLOB_BYTES; i++) {
        const m = next[i]
        if (m.file?.url) {
          const f = { ...m.file }
          revokeFile(f)
          delete f.blob
          delete f.url
          f.failed = 'evicted from memory'
          next[i] = { ...m, file: f }
          bytes -= m.file.size
        }
      }
      return next
    })
  }

  function onPaste(e: React.ClipboardEvent) {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault()
      sendFiles(e.clipboardData.files)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (e.dataTransfer.files.length > 0) sendFiles(e.dataTransfer.files)
  }

  function resetComposerHeight() {
    const el = composerRef.current
    if (el) el.style.height = 'auto'
  }

  function growComposer() {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-border-strong bg-background/80">
          <p className="text-sm font-medium text-foreground">drop to send</p>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Users className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-mono text-xs text-muted-foreground">
          {peers.length + 1} online
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs text-dim"
          title={peers.map((p) => p.name).join(', ')}
        >
          {peers.map((p) => p.name).join(', ')}
        </span>
        {'Notification' in window && (
          <button
            onClick={() => {
              if (Notification.permission === 'default') {
                void Notification.requestPermission().then(setNotify)
              } else {
                setNotify(Notification.permission)
              }
            }}
            aria-label={
              notify === 'granted' ? 'notifications on' : 'enable browser notifications'
            }
            aria-pressed={notify === 'granted'}
            title={
              notify === 'granted'
                ? 'notifications on'
                : notify === 'denied'
                  ? 'notifications blocked by the browser'
                  : 'notify me of new messages'
            }
            className="rounded-md p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            {notify === 'granted' ? (
              <BellRing className="size-4 text-emphasis" aria-hidden />
            ) : notify === 'denied' ? (
              <BellOff className="size-4" aria-hidden />
            ) : (
              <Bell className="size-4" aria-hidden />
            )}
          </button>
        )}
        <span
          role="status"
          className={cn(
            'shrink-0 font-mono text-[10px]',
            connected ? 'text-success' : 'text-destructive',
          )}
        >
          {connected ? 'online' : 'reconnecting'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label="chat messages"
          className="h-full space-y-3 overflow-y-auto px-3 py-3"
        >
          {messages.length === 0 && (
            <p className="pt-8 text-center text-xs text-dim">
              messages and files go peer to peer, nothing is stored
            </p>
          )}
          {messages.map((m) => (
            <MessageRow key={m.id} msg={m} />
          ))}
          {typing.length > 0 && (
            <p className="text-xs text-muted-foreground" aria-live="off">
              {typing.map((p) => p.name).join(', ')} {typing.length === 1 ? 'is' : 'are'}{' '}
              typing...
            </p>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={jumpToLatest}
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md hover:bg-hover"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {unread} new
          </button>
        )}
      </div>

      <div className="border-t border-border p-3">
        {error && (
          <p role="alert" className="pb-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            aria-label="choose files to send"
            onChange={(e) => {
              if (e.target.files) sendFiles(e.target.files)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="send file"
            title="send file peer to peer (or paste / drop)"
            className="rounded-md border border-border bg-card p-2 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-50"
          >
            <Paperclip className="size-4" aria-hidden />
          </button>
          <textarea
            ref={composerRef}
            value={body}
            onChange={(e) => {
              onBodyChange(e.target.value)
              growComposer()
            }}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              } else if (e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder="message  (/ to focus, enter to send)"
            aria-label="message"
            rows={1}
            autoFocus
            className="min-w-0 flex-1 resize-none rounded-md border border-border bg-recessed px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <button
            onClick={send}
            disabled={!body.trim()}
            aria-label="send message"
            className="rounded-md bg-inverted p-2 text-inverted-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizonal className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
