import { Route, Switch } from 'wouter'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import Mark from './components/Mark'

export default function App() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/r/:id">{(params) => <RoomPage id={params.id} />}</Route>
      <Route>
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <Mark size={40} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">page not found</p>
          <a
            href="/"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-hover"
          >
            home
          </a>
        </div>
      </Route>
    </Switch>
  )
}
