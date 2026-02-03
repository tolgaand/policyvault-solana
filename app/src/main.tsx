import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@solana/wallet-adapter-react-ui/styles.css'
import './index.css'

import App from './App.tsx'
import { Providers } from './Providers'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
)
