// SPDX-License-Identifier: 0BSD
// Local profile: a display name and an avatar image stored client
// side only. The avatar ships to peers as a 64px data url over the
// chat channel, so the bytes never touch the server.

const NAME_KEY = 'qc-name'
const AVATAR_KEY = 'qc-avatar'

export function loadProfile(): { name?: string; avatar?: string } {
  const name = localStorage.getItem(NAME_KEY) || undefined
  const avatar = localStorage.getItem(AVATAR_KEY) || undefined
  const out: { name?: string; avatar?: string } = {}
  if (name) out.name = name
  if (avatar) out.avatar = avatar
  return out
}

export function saveName(name: string) {
  if (name) localStorage.setItem(NAME_KEY, name)
  else localStorage.removeItem(NAME_KEY)
}

export function saveAvatar(data: string) {
  if (data) localStorage.setItem(AVATAR_KEY, data)
  else localStorage.removeItem(AVATAR_KEY)
}

export function clearProfile() {
  localStorage.removeItem(NAME_KEY)
  localStorage.removeItem(AVATAR_KEY)
}

// resizeAvatar center-crops and scales a picked image to a 64px png
// data url, small enough for a datachannel broadcast
export function resizeAvatar(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const s = Math.min(img.width, img.height)
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const g = c.getContext('2d')
      if (!g) {
        reject(new Error('no canvas'))
        return
      }
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('not an image'))
    }
    img.src = url
  })
}
