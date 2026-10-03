export interface Peer {
  id: string
  name: string
  /** data url image, set after the peer broadcasts one */
  avatar?: string
}

export interface FileMeta {
  id: string
  name: string
  size: number
  mime: string
}

// FileRef is a FileMeta plus local transfer state. The blob lives in
// memory only and is never uploaded.
export interface FileRef extends FileMeta {
  /** local blob once the file is available */
  blob?: Blob | undefined
  /** object url for blob, revoked on cleanup */
  url?: string | undefined
  /** 0..1 while transferring */
  progress?: number | undefined
  failed?: string | undefined
}

// ReplyRef is the quote block embedded in a chat frame. Messages are
// never stored, so the quoted text travels with the reply itself.
export interface ReplyRef {
  id: string
  name: string
  body?: string
  /** file name when the quoted message was a file */
  file?: string
}

export interface ChatMessage {
  id: string
  peer: Peer
  body?: string
  file?: FileRef
  ts: number
  reply?: ReplyRef
  /** emoji to peer names who placed it */
  reactions?: Record<string, string[]>
  /** sender unsent it; body and file are stripped */
  deleted?: boolean
  /** local only: sending in progress */
  pending?: boolean
  /** local only: presence or event line rendered as system text, not a chat */
  sys?: 'join' | 'leave' | 'event'
}

export interface RoomInfo {
  id: string
  peers: number
  livekit: boolean
  iceServers: string[]
  maxFileSize: number
}

export interface LiveKitGrant {
  url: string
  token: string
  identity: string
}
