import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { reloadForChunkError } from './lib/recovery'
import './app.css'

// last resort for chunk load failures that never reach a boundary, eg a
// lazy import triggered from an event handler. reloadForChunkError is
// guarded so a broken deploy cannot loop
window.addEventListener('unhandledrejection', (e) => {
  if (reloadForChunkError(e.reason)) e.preventDefault()
})
window.addEventListener('error', (e) => {
  reloadForChunkError(e.error ?? e.message)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
