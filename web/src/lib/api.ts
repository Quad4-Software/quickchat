import type { AttachmentMeta, LiveKitGrant, RoomInfo } from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function createRoom(): Promise<{ id: string }> {
  return req('/api/rooms', { method: 'POST' })
}

export function getRoom(id: string): Promise<RoomInfo> {
  return req(`/api/rooms/${id}`)
}

export function livekitToken(room: string, name: string): Promise<LiveKitGrant> {
  return req(`/api/rooms/${room}/token?name=${encodeURIComponent(name)}`)
}

export function uploadAttachment(room: string, file: File): Promise<AttachmentMeta> {
  return req(`/api/rooms/${room}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
}

export function attachmentUrl(room: string, id: string): string {
  return `/api/rooms/${room}/attachments/${id}`
}
