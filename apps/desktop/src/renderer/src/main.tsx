/// <reference types="vite/client" />
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './ui/tokens.css'
import App from './App'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('missing #root element')
}

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
