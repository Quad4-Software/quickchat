// SPDX-License-Identifier: 0BSD

// reactMutate toggles one peer's name under an emoji. The map shape
// (emoji to peer names) is what MessageRow renders directly. A name
// appears at most once per emoji, and an emoji key is dropped when its
// last name leaves so the row never renders an empty chip.
export function reactMutate(
  r: Record<string, string[]> | undefined,
  emoji: string,
  name: string,
  on: boolean,
): Record<string, string[]> {
  const next = { ...(r ?? {}) }
  const names = (next[emoji] ?? []).filter((n) => n !== name)
  if (on) names.push(name)
  if (names.length) next[emoji] = names
  else delete next[emoji]
  return next
}
