import { FileIcon, Loader2, TriangleAlert } from 'lucide-react'
import { fileSize, timestamp } from '../lib/format'
import { cn } from '../lib/cn'
import type { ChatMessage, FileRef } from '../lib/types'

export default function MessageRow({ msg }: { msg: ChatMessage }) {
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
      {msg.file && <FileCard file={msg.file} />}
    </div>
  )
}

function FileCard({ file }: { file: FileRef }) {
  if (file.failed) {
    return (
      <p className="mt-1 flex w-fit items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground">
        <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-dim">{file.failed}</span>
      </p>
    )
  }

  if (!file.url) {
    return (
      <p className="mt-1 flex w-fit items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-dim">
          {file.progress !== undefined
            ? `${Math.round(file.progress * 100)}%`
            : fileSize(file.size)}
        </span>
      </p>
    )
  }

  if (file.mime.startsWith('image/')) {
    return (
      <span className="mt-1 block">
        <a href={file.url} target="_blank" rel="noreferrer" className="block w-fit">
          <img
            src={file.url}
            alt={file.name}
            className="max-h-48 w-auto rounded-md border border-border"
            loading="lazy"
            decoding="async"
          />
        </a>
        {file.progress !== undefined && (
          <span className="font-mono text-[10px] text-dim">
            sending {Math.round(file.progress * 100)}%
          </span>
        )}
      </span>
    )
  }

  return (
    <span className="mt-1 block w-fit max-w-full">
      <a
        href={file.url}
        download={file.name}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 hover:bg-hover"
      >
        <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm text-foreground">{file.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-dim">
          {fileSize(file.size)}
        </span>
      </a>
      {file.progress !== undefined && (
        <span className="font-mono text-[10px] text-dim">
          sending {Math.round(file.progress * 100)}%
        </span>
      )}
    </span>
  )
}
