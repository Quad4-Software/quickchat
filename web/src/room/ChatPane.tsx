import { useEffect, useRef, useState } from 'react'
import { FileIcon, Paperclip, SendHorizonal, Users } from 'lucide-react'
import { ChatSocket } from '../lib/chat'
import { attachmentUrl, uploadAttachment } from '../lib/api'
import { fileSize, timestamp } from '../lib/format'
import { cn } from '../lib/cn'
import type { ChatMessage, Peer } from '../lib/types'

const MAX_MESSAGES = 500
const TYPING_MS = 4000

export default function ChatPane({ room, name }: { room: string; name: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [typing, setTyping] = useState<Peer[]>([])
  const [connected, setConnected] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [body, setBody] = useState('')

  const socketRef = useRef<ChatSocket | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimers = useRef(new Map<string, number>())
  const typingSentAt = useRef(0)

  useEffect(() => {
    const s = new ChatSocket()
    s.onEvent = (e) => {
      switch (e.type) {
        case 'welcome':
          setConnected(true)
          setPeers(e.peers)
          break
        case 'peer_joined':
          setPeers((p) => [...p, e.peer])
          break
        case 'peer_left':
          setPeers((p) => p.filter((x) => x.id !== e.peer.id))
          break
        case 'chat':
          setMessages((m) => [...m.slice(-MAX_MESSAGES + 1), e.message])
          break
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
            setTyping((t) =>
              t.some((x) => x.id === e.peer.id) ? t : [...t, e.peer],
            )
          } else {
            setTyping((t) => t.filter((x) => x.id !== e.peer.id))
          }
          break
        }
      }
    }
    s.onClose = () => setConnected(false)
    s.connect(room, name)
    socketRef.current = s
    return () => {
      s.close()
      typingTimers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [room, name])

  useEffect(() => {
    const el = listRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = listRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  function send() {
    const text = body.trim()
    if (!text) return
    socketRef.current?.send(text)
    socketRef.current?.setTyping(false)
    setBody('')
  }

  function onBodyChange(v: string) {
    setBody(v)
    const now = Date.now()
    if (v && now - typingSentAt.current > 1500) {
      typingSentAt.current = now
      socketRef.current?.setTyping(true)
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setUploading(true)
    try {
      const meta = await uploadAttachment(room, f)
      socketRef.current?.send(body.trim(), meta.id)
      setBody('')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Users className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">
          {peers.length + 1} online
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-dim">
          {peers.map((p) => p.name).join(', ')}
        </span>
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            connected ? 'bg-success' : 'bg-destructive',
          )}
          title={connected ? 'connected' : 'disconnected'}
        />
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
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
          <p className="text-xs text-muted-foreground">
            {typing.map((p) => p.name).join(', ')}{' '}
            {typing.length === 1 ? 'is' : 'are'} typing...
          </p>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="attach file"
            className="rounded-md border border-border bg-card p-2 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-50"
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={uploading ? 'uploading...' : 'message'}
            rows={1}
            className="min-w-0 flex-1 resize-none rounded-md border border-border bg-recessed px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <button
            onClick={send}
            disabled={!body.trim()}
            aria-label="send message"
            className="rounded-md bg-inverted p-2 text-inverted-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizonal className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageRow({ room, msg }: { room: string; msg: ChatMessage }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-sm font-semibold text-emphasis">
          {msg.peer.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-dim">
          {timestamp(msg.ts)}
        </span>
      </div>
      {msg.body && (
        <p className="break-words text-sm text-foreground">{msg.body}</p>
      )}
      {msg.attachment && (
        <Attachment room={room} att={msg.attachment} />
      )}
    </div>
  )
}

function Attachment({
  room,
  att,
}: {
  room: string
  att: { id: string; name: string; size: number; mime: string }
}) {
  const url = attachmentUrl(room, att.id)
  if (att.mime.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
        <img
          src={url}
          alt={att.name}
          className="max-h-48 rounded-md border border-border"
          loading="lazy"
        />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1 flex w-fit max-w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 hover:bg-hover"
    >
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm text-foreground">{att.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-dim">
        {fileSize(att.size)}
      </span>
    </a>
  )
}
