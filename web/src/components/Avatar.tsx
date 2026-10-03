// SPDX-License-Identifier: 0BSD
import { cn } from '../lib/cn'

// Avatar renders the data url image when present, else the peer
// initial in a neutral square
export default function Avatar({
  name,
  avatar,
  className,
}: {
  name: string
  avatar?: string | undefined
  className?: string | undefined
}) {
  const box = cn(
    'size-5 shrink-0 select-none overflow-hidden rounded-md border border-border bg-recessed',
    className,
  )
  if (avatar) {
    return <img src={avatar} alt={name} className={cn(box, 'object-cover')} />
  }
  return (
    <span
      className={cn(
        box,
        'flex items-center justify-center font-mono text-[10px] font-semibold uppercase text-muted-foreground',
      )}
    >
      {name.slice(0, 1) || '?'}
    </span>
  )
}
