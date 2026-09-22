import { lazy, Suspense, useEffect, useState } from 'react'
import { Router, Route, Switch } from 'wouter'
import { useBrowserLocation } from 'wouter/use-browser-location'
import { useHashLocation } from 'wouter/use-hash-location'
import { RefreshCw } from 'lucide-react'
import HomePage from './pages/HomePage'
import Mark from './components/Mark'
import { initPwa } from './lib/pwa'

const DocsPage = lazy(() => import('./pages/DocsPage'))
const DemoPage = lazy(() => import('./pages/DemoPage'))
const RoomPage = lazy(() => import('./pages/RoomPage'))

// the demo bundle runs fully client side on static hosting: hash routing
// needs no server fallback and the demo room replaces the landing page
const DEMO = import.meta.env.VITE_DEMO === '1'

function NotFound() {
  return (
    <main id="main" className="flex h-full flex-col items-center justify-center gap-4">
      <Mark size={40} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">page not found</p>
      <a
        href="/"
        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
      >
        home
      </a>
    </main>
  )
}

function lazyFallback() {
  return (
    <main id="main" className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">loading...</p>
    </main>
  )
}

export default function App() {
  const [reload, setReload] = useState<(() => void) | null>(null)

  useEffect(() => {
    if (!DEMO) initPwa((r) => setReload(() => r))
  }, [])

  return (
    <Router hook={DEMO ? useHashLocation : useBrowserLocation}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-sm focus:text-foreground"
      >
        skip to content
      </a>
      <Switch>
        <Route path="/">
          {DEMO ? (
            <Suspense fallback={lazyFallback()}>
              <DemoPage />
            </Suspense>
          ) : (
            <HomePage />
          )}
        </Route>
        {!DEMO && (
          <Route path="/r/:id">
            {(params) => (
              <Suspense fallback={lazyFallback()}>
                <RoomPage id={params.id} />
              </Suspense>
            )}
          </Route>
        )}
        <Route path="/demo">
          <Suspense fallback={lazyFallback()}>
            <DemoPage />
          </Suspense>
        </Route>
        {!DEMO && (
          <Route path="/docs">
            <Suspense fallback={lazyFallback()}>
              <DocsPage />
            </Suspense>
          </Route>
        )}
        <Route>
          <NotFound />
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
    </Router>
  )
}
