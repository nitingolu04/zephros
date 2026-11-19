import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  // In hosted builds the API lives on another host; without this the app would call itself and get HTML.
  // Vercel sets VERCEL automatically; render.yaml sets REQUIRE_API_URL for the Render static site.
  const hosted = process.env.VERCEL || process.env.REQUIRE_API_URL === 'true'
  if (hosted && mode === 'production' && !loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL) {
    throw new Error('VITE_API_URL is not set. Add your backend URL in your host\'s Environment settings (Render or Vercel), then redeploy.')
  }
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Vite 8 / Rolldown can split sonner into a chunk that circular-imports react-dom
    // from the entry bundle, crashing the whole app with "r is not a function".
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules\/(react-dom|react|scheduler)\//,
              priority: 30,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Dev only: lets a temporary HTTPS tunnel (Cloudflare or ngrok) reach this server, so other
    // devices can test camera, mic and screen share, which browsers only allow over HTTPS.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  }
})
