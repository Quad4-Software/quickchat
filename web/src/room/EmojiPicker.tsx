import { useEffect, useRef } from 'react'

// a compact frequently-used set: enough coverage without shipping a
// multi-hundred-kb picker library
const EMOJIS = [
  '👍',
  '👎',
  '❤️',
  '🔥',
  '😂',
  '😮',
  '😢',
  '😡',
  '✅',
  '❌',
  '🎉',
  '👀',
  '🙏',
  '💯',
  '🤔',
  '😅',
  '😊',
  '😍',
  '🤝',
  '👋',
  '🙌',
  '🤯',
  '😴',
  '🥳',
  '😎',
  '🤨',
  '😐',
  '😬',
  '🤷',
  '💪',
  '🫡',
  '🤫',
  '🚀',
  '⭐',
  '📌',
  '🔔',
  '💡',
  '🐛',
  '🩹',
  '🧠',
  '☕',
  '🍕',
  '🍺',
  '🎧',
  '📈',
  '📉',
  '🗑️',
  '🔒',
]

export default function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="emoji picker"
      className="absolute bottom-full right-0 z-20 mb-1.5 grid w-56 grid-cols-8 gap-0.5 rounded-md border border-border bg-card p-1.5 shadow-md"
    >
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => {
            onPick(e)
            onClose()
          }}
          className="rounded p-1 text-base leading-none hover:bg-hover"
        >
          {e}
        </button>
      ))}
    </div>
  )
}
