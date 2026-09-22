import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Switch } from 'wouter'
import { RefreshCw } from 'lucide-react'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import Mark from './components/Mark'
import { initPwa } from './lib/pwa'

const DocsPage = lazy(() => import('./pages/DocsPage'))

export default function App() {
  const [reload, setReload] = useState<(() => void) | null>(null)

  useEffect(() => {
    initPwa((r) => setReload(() => r))
  }, [])

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-sm focus:text-foreground"
      >
        skip to content
      </a>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/r/:id">{(params) => <RoomPage id={params.id} />}</Route>
        <Route path="/docs">
          <Suspense
            fallback={
              <main id="main" className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">loading docs...</p>
              </main>
            }
          >
            <DocsPage />
          </Suspense>
        </Route>
        <Route>
          <main
            id="main"
            className="flex h-full flex-col items-center justify-center gap-4"
          >
            <Mark size={40} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">page not found</p>
            <a
              href="/"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
            >
              home
            </a>
          </main>
        </Route>
      </Switch>
      {reload && (
        <button
          onClick={reload}
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md hover:bg-hover"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          update available
        </button>
      )}
    </>
  )
}
