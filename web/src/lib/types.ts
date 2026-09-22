export interface Peer {
  id: string
  name: string
}

export interface AttachmentMeta {
  id: string
  name: string
  size: number
  mime: string
}

export interface ChatMessage {
  id: string
  peer: Peer
  body?: string
  attachment?: AttachmentMeta
  ts: number
}

export type ServerEvent =
  | { type: 'welcome'; self: Peer; peers: Peer[] }
  | { type: 'peer_joined'; peer: Peer }
  | { type: 'peer_left'; peer: Peer }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'typing'; peer: Peer; typing: boolean }

export interface RoomInfo {
  id: string
  peers: number
  livekit: boolean
}

export interface LiveKitGrant {
  url: string
  token: string
  identity: string
}
