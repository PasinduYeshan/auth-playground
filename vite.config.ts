import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Static hosting cannot send headers, so production pages carry their CSP in a meta tag. Scripts load
// only from this origin; connect-src stays open because the user chooses which servers to call.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  'connect-src *',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }
}

// Two HTML entries load the same app: `/` and `/callback/`. The second is a real file in the build, so
// the redirect URI works on static hosting (GitHub Pages) without a 404.html fallback.
export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  base: process.env.BASE_PATH ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        callback: resolve(__dirname, 'callback/index.html'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
})
