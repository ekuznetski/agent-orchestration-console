import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { AppErrorFallback } from '@/components/console/AppErrorFallback'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
