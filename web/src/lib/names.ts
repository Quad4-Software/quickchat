const ADJECTIVES = [
  'amber',
  'ashen',
  'brisk',
  'calm',
  'cobalt',
  'crimson',
  'dusky',
  'faint',
  'fierce',
  'frost',
  'golden',
  'hollow',
  'ivory',
  'jade',
  'lunar',
  'mellow',
  'misty',
  'onyx',
  'pale',
  'quiet',
  'rapid',
  'rustic',
  'silent',
  'silver',
  'solar',
  'static',
  'stellar',
  'vivid',
] as const

const NOUNS = [
  'atlas',
  'beacon',
  'cedar',
  'comet',
  'drift',
  'ember',
  'falcon',
  'fjord',
  'glacier',
  'harbor',
  'heron',
  'islet',
  'kestrel',
  'lagoon',
  'lynx',
  'mesa',
  'nebula',
  'otter',
  'pumice',
  'quartz',
  'ridge',
  'signal',
  'sparrow',
  'talon',
  'umbra',
  'vertex',
  'willow',
  'zephyr',
] as const

const SUFFIX_SPACE = 100

export function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const n = Math.floor(Math.random() * SUFFIX_SPACE)
  return `${adj}-${noun}-${n}`
}
