/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** set to 1 by build:demo for the static gh pages bundle */
  readonly VITE_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
