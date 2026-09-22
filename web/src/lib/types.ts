export interface Peer {
  id: string
  name: string
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

export interface ChatMessage {
  id: string
  peer: Peer
  body?: string
  file?: FileRef
  ts: number
  /** local only: sending in progress */
  pending?: boolean
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
