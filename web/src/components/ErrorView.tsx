// SPDX-License-Identifier: 0BSD
import type { ReactNode } from 'react'
import Mark from './Mark'

// shared error surface: not found pages, crash fallbacks, and dead rooms
// all render through this so every failure looks deliberate
export default function ErrorView({
  code,
  title,
  detail,
  children,
}: {
  code?: string | undefined
  title: string
  detail?: string | undefined
  children?: ReactNode
}) {
  return (
    <main
      id="main"
      className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <Mark size={40} className="text-muted-foreground" />
      <div className="space-y-1">
        {code && <p className="font-mono text-xs text-muted-foreground">{code}</p>}
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && (
          <p className="mx-auto max-w-md truncate font-mono text-[11px] text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 pt-1">{children}</div>}
    </main>
  )
}
