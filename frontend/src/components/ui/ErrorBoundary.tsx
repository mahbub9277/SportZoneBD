import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children?: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-[40vh] items-center justify-center px-6 py-10">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface-soft/80 p-6 text-center shadow-lg">
              <p className="text-lg font-semibold text-text-primary">Something went wrong</p>
              <p className="mt-2 text-sm text-text-muted">
                We couldn’t load this section. Please refresh the page or try again in a moment.
              </p>
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}
