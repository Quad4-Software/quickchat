import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Router, Route, Switch, useLocation } from 'wouter'
import { useBrowserLocation } from 'wouter/use-browser-location'
import { useHashLocation } from 'wouter/use-hash-location'
import { RefreshCw } from 'lucide-react'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import ErrorBoundary from './components/ErrorBoundary'
import ErrorView from './components/ErrorView'
import { initPwa } from './lib/pwa'

const DocsPage = lazy(() => import('./pages/DocsPage'))
const DemoPage = lazy(() => import('./pages/DemoPage'))

// the demo bundle runs fully client side on static hosting: hash routing
// needs no server fallback and the demo room replaces the landing page
const DEMO = import.meta.env.VITE_DEMO === '1'

function NotFound() {
  return (
    <ErrorView code="404" title="page not found">
      <Link
        href="/"
        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
      >
        home
      </Link>
    </ErrorView>
  )
}

// unlinked crash probe: lets e2e and humans verify the error boundary
// and its recovery path in a real build
function CrashProbe(): never {
  throw new Error('crash probe')
}

// boundary sits inside the router so location changes reset a crashed
// route without losing the app shell
function Routes() {
  const [location] = useLocation()
  return (
    <ErrorBoundary resetKey={location}>
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
        {!DEMO && <Route path="/r/:id">{(params) => <RoomPage id={params.id} />}</Route>}
        <Route path="/demo">
          <Suspense fallback={lazyFallback()}>
            <DemoPage />
          </Suspense>
        </Route>
        <Route path="/docs">
          <Suspense fallback={lazyFallback()}>
            <DocsPage />
          </Suspense>
        </Route>
        <Route path="/crash" component={CrashProbe} />
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </ErrorBoundary>
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
      <Routes />
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
