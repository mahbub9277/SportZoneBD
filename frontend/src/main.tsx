import React from 'react'
import './lib/patchReactKey'
import ReactDOM from 'react-dom/client'
import AppProvider from '@/app/providers/AppProvider'
import { App } from '@/App.tsx'
import './index.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  }, { once: true })
}

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
)