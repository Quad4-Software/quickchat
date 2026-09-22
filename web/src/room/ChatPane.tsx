import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Paperclip, SendHorizonal, Users } from 'lucide-react'
import { ChatSocket, newNonce } from '../lib/chat'
import { uploadAttachment } from '../lib/api'
import { SITE } from '../lib/site'
import { cn } from '../lib/cn'
import MessageRow from './MessageRow'
import type { ChatMessage, Peer } from '../lib/types'

const MAX_MESSAGES = 500
const TYPING_MS = 4000
const TYPING_THROTTLE_MS = 1500
const PIN_THRESHOLD_PX = 40

function bumpTitle() {
  const cur = /^\((\d+)\)/.exec(document.title)
  const n = (cur ? Number(cur[1]) : 0) + 1
  document.title = `(${n}) ${SITE.name}`
}

export default function ChatPane({ room, name }: { room: string; name: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [typing, setTyping] = useState<Peer[]>([])
  const [connected, setConnected] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [body, setBody] = useState('')

  const socketRef = useRef<ChatSocket | null>(null)
  const selfRef = useRef<Peer>({ id: 'me', name })
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pinnedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimers = useRef(new Map<string, number>())
  const typingSentAt = useRef(0)
  const dragDepth = useRef(0)

  useEffect(() => {
    const s = new ChatSocket()
    s.onEvent = (e) => {
      switch (e.type) {
        case 'welcome':
          selfRef.current = e.self
          setConnected(true)
          setPeers(e.peers)
          break
        case 'peer_joined':
          setPeers((p) => (p.some((x) => x.id === e.peer.id) ? p : [...p, e.peer]))
          break
        case 'peer_left':
          setPeers((p) => p.filter((x) => x.id !== e.peer.id))
          setTyping((t) => t.filter((x) => x.id !== e.peer.id))
          break
        case 'chat': {
          const msg = e.message
          setMessages((m) => {
            // replace the optimistic copy when our own echo arrives
            if (msg.nonce) {
              const i = m.findIndex((x) => x.pending && x.nonce === msg.nonce)
              if (i >= 0) {
                const next = m.slice()
                next[i] = msg
                return next
              }
            }
            if (m.some((x) => x.id === msg.id)) return m
            return [...m.slice(-MAX_MESSAGES + 1), msg]
          })
          if (msg.peer.id !== selfRef.current.id) {
            if (!pinnedRef.current) setUnread((n) => n + 1)
            if (document.hidden) bumpTitle()
          }
          break
        }
        case 'typing': {
          const timers = typingTimers.current
          window.clearTimeout(timers.get(e.peer.id))
          if (e.typing) {
            timers.set(
              e.peer.id,
              window.setTimeout(
                () => setTyping((t) => t.filter((x) => x.id !== e.peer.id)),
                TYPING_MS,
              ),
            )
            setTyping((t) => (t.some((x) => x.id === e.peer.id) ? t : [...t, e.peer]))
          } else {
            setTyping((t) => t.filter((x) => x.id !== e.peer.id))
          }
          break
        }
      }
    }
    s.onStateChange = setConnected
    s.connect(room, name)
    socketRef.current = s
    const timers = typingTimers.current
    return () => {
      s.close()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [room, name])

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

  function pushMessage(body_: string, attachment?: ChatMessage['attachment']) {
    const nonce = newNonce()
    const msg: ChatMessage = {
      id: `local-${nonce}`,
      peer: selfRef.current,
      body: body_,
      nonce,
      ts: Date.now(),
      pending: true,
      ...(attachment ? { attachment } : {}),
    }
    setMessages((m) => [...m.slice(-MAX_MESSAGES + 1), msg])
    pinnedRef.current = true
    socketRef.current?.send(body_, attachment?.id, nonce)
  }

  function send() {
    const text = body.trim()
    if (!text) return
    pushMessage(text)
    socketRef.current?.setTyping(false)
    setBody('')
    resetComposerHeight()
  }

  function onBodyChange(v: string) {
    setBody(v)
    const now = Date.now()
    if (v && now - typingSentAt.current > TYPING_THROTTLE_MS) {
      typingSentAt.current = now
      socketRef.current?.setTyping(true)
    }
  }

  async function uploadFiles(files: Iterable<File>) {
    for (const f of files) {
      setUploading((n) => n + 1)
      setError('')
      try {
        const meta = await uploadAttachment(room, f)
        pushMessage(body.trim(), meta)
        setBody('')
        resetComposerHeight()
      } catch (e) {
        setError(e instanceof Error ? e.message : `upload failed: ${f.name}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function onPaste(e: React.ClipboardEvent) {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault()
      void uploadFiles(e.clipboardData.files)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files)
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
          <p className="text-sm font-medium text-foreground">drop to attach</p>
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
        <span
          role="status"
          className="flex items-center gap-1.5"
          title={connected ? 'connected' : 'disconnected'}
        >
          <span className="sr-only">{connected ? 'connected' : 'disconnected'}</span>
          {!connected && (
            <span className="font-mono text-[10px] text-destructive" aria-hidden>
              reconnecting
            </span>
          )}
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              connected ? 'bg-success' : 'bg-destructive',
            )}
            aria-hidden
          />
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
              messages disappear when you leave
            </p>
          )}
          {messages.map((m) => (
            <MessageRow key={m.id} room={room} msg={m} />
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
            aria-label="choose files to attach"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
            aria-label="attach file"
            title="attach file (or paste / drop)"
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
            placeholder={
              uploading > 0 ? 'uploading...' : 'message  (/ to focus, enter to send)'
            }
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
