import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Polyfill Buffer for Solana/web3 + wallet adapters in the browser.
// Vite no longer provides Node globals by default.
import { Buffer } from 'buffer'

import './index.css'

import App from './App.tsx'

if (!('Buffer' in globalThis)) {
  ;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
