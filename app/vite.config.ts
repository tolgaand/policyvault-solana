import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The demo pulls in heavy wallet + Solana deps. We allow a slightly higher
    // chunk size warning threshold to avoid noisy CI logs while still keeping
    // the landing page code-split via lazy-loading.
    chunkSizeWarningLimit: 700,
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

          // Keep Solana client deps in the generic vendor chunk.
          // Some transitive deps create circular chunk graphs when split.
          return 'vendor'
        },
      },
    },
  },
})
