import React from 'react'
import './lib/patchReactKey'
import ReactDOM from 'react-dom/client'
import AppProvider from '@/app/providers/AppProvider'
import { App } from '@/App.tsx'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
)