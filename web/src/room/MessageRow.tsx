import { FileIcon } from 'lucide-react'
import { attachmentUrl } from '../lib/api'
import { fileSize, timestamp } from '../lib/format'
import { cn } from '../lib/cn'
import type { AttachmentMeta, ChatMessage } from '../lib/types'

export default function MessageRow({ room, msg }: { room: string; msg: ChatMessage }) {
  return (
    <div className={cn('min-w-0', msg.pending && 'opacity-50')}>
      <div className="flex items-baseline gap-2">
        <span className="truncate text-sm font-semibold text-emphasis">
          {msg.peer.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-dim">
          {msg.pending ? 'sending...' : timestamp(msg.ts)}
        </span>
      </div>
      {msg.body && <p className="break-words text-sm text-foreground">{msg.body}</p>}
      {msg.attachment && <Attachment room={room} att={msg.attachment} />}
    </div>
  )
}

function Attachment({ room, att }: { room: string; att: AttachmentMeta }) {
  const url = attachmentUrl(room, att.id)
  if (att.mime.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
        <img
          src={url}
          alt={att.name}
          className="max-h-48 w-auto rounded-md border border-border"
          loading="lazy"
          decoding="async"
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
      <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate text-sm text-foreground">{att.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-dim">
        {fileSize(att.size)}
      </span>
    </a>
  )
}
