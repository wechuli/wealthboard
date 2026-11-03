/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "http" (default) talks to /api/v1; "mock" uses in-memory fixtures. */
  readonly VITE_DATA_SOURCE?: 'http' | 'mock'
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
