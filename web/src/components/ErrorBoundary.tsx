// SPDX-License-Identifier: 0BSD
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Link } from 'wouter'
import { TriangleAlert } from 'lucide-react'
import ErrorView from './ErrorView'
import { reloadForChunkError } from '../lib/recovery'

interface Props {
  children: ReactNode
  // page fills the viewport, panel fills its parent region so the rest of
  // the app keeps working
  variant?: 'page' | 'panel'
  // panel fallback heading, eg 'voice and video'
  label?: string
  // when this value changes the boundary resets, so navigation recovers a
  // crashed route without a manual retry
  resetKey?: unknown
}

interface State {
  err: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // a stale bundle crashes on import(); reload once for the new index
    reloadForChunkError(err)
    console.error('ui crash:', err, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.err && prev.resetKey !== this.props.resetKey) {
      this.setState({ err: null })
    }
  }

  reset = () => this.setState({ err: null })

  render() {
    const { err } = this.state
    if (!err) return this.props.children

    if (this.props.variant === 'panel') {
      return (
        <div
          role="alert"
          className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <TriangleAlert className="size-5 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {this.props.label ?? 'this section'} hit an error
            </p>
            <p className="mx-auto max-w-xs truncate font-mono text-[11px] text-muted-foreground">
              {err.message}
            </p>
          </div>
          <button
            onClick={this.reset}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-hover"
          >
            try again
          </button>
        </div>
      )
    }

    return (
      <div role="alert" className="h-full">
        <ErrorView code="crash" title="something broke" detail={err.message}>
          <button
            onClick={this.reset}
            className="rounded-md bg-inverted px-3 py-1.5 text-sm font-semibold text-inverted-foreground shadow-sm hover:opacity-90"
          >
            try again
          </button>
          <button
            onClick={() => location.reload()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
          >
            reload
          </button>
          <Link
            href="/"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
          >
            home
          </Link>
        </ErrorView>
      </div>
    )
  }
}
