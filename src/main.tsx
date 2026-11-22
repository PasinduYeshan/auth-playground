import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

// GitHub Pages cannot send frame-ancestors or X-Frame-Options, and a meta CSP cannot set them. So the
// app refuses to run inside a frame: another site could otherwise overlay it and steer clicks.
if (window.top !== window.self) {
  root.render(
    <p style={{ padding: 16, fontFamily: 'system-ui' }}>
      Auth Playground does not run inside a frame. <a href={import.meta.env.BASE_URL} target="_top" rel="noopener">Open it directly.</a>
    </p>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
