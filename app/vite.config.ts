import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          // Keep chunky crypto/wallet libs in their own files so the landing page
          // can load fast even when the demo section pulls in heavy deps.
          if (
            id.includes('@walletconnect') ||
            id.includes('@reown') ||
            id.includes('wagmi') ||
            id.includes('viem')
          ) {
            return 'wallet'
          }

          // Split core frameworks from the generic vendor chunk.
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react'
          }

          // NOTE: Avoid splitting Solana client deps into their own chunk here.
          // Some transitive deps create circular chunk graphs (vendor <-> solana).

          return 'vendor'
        },
      },
    },
  },
})
