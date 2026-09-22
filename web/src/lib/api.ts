import type { LiveKitGrant, RoomInfo } from './types'

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
