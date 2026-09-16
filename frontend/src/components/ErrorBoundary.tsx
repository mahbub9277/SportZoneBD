import { Component, type ErrorInfo, type ReactNode } from 'react'
import logger from '../core/logger'

interface Props {
  children?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
  resetKey: number
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    resetKey: 0,
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      resetKey: 0,
    }
  }

  public componentDidMount() {
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  public componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason

    const reasonText = reason instanceof Error
      ? `${reason.name} ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : ''
    const expectedMediaInterruption = /play\(\) request was interrupted|play\(\) request was aborted|media resource.*aborted|the fetching process for the media resource was aborted|source.*changed|media source/i.test(reasonText)

    if (expectedMediaInterruption) {
      event.preventDefault()
      return
    }

    const getDomException = (value: unknown): DOMException | null => {
      if (value instanceof DOMException) return value
      if (typeof value === 'object' && value !== null) {
        const nested = (value as any).error ?? (value as any).reason
        if (nested instanceof DOMException) return nested
      }
      return null
    }

    const dom = getDomException(reason)
    if (dom) {
      const reasonName = typeof dom.name === 'string' ? dom.name.toLowerCase() : ''
      const message = typeof dom.message === 'string' ? dom.message.toLowerCase() : ''
      const isNotSuitableError = /media resource indicated by the src attribute or assigned media provider object was not suitable/i.test(message)
      const isAbortError = reasonName === 'aborterror' && /fetching process for the media resource was aborted/i.test(message)
      const isNotSupportedFallback = reasonName === 'notsupportederror' && isNotSuitableError

      if (isAbortError || isNotSupportedFallback) {
        event.preventDefault()
        return
      }
    }

    const error = reason instanceof Error
      ? reason
      : new Error(String(reason ?? 'Unknown promise rejection reason'))

    logger.error('Unhandled promise rejection', { error })
    event.preventDefault()
    this.setState({ hasError: true, error })
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught render error', {
      error: { message: error.message, stack: error.stack },
      errorInfo,
    })
    this.setState({ error, errorInfo })
  }

  private resetErrorBoundary = () => {
    this.setState((prevState) => ({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      resetKey: prevState.resetKey + 1,
    }))
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            textAlign: 'center',
            backgroundColor: 'var(--background, #0A0C1C)',
            color: 'var(--text-primary, #FFFFFF)',
            fontFamily: 'system-ui, sans-serif',
            padding: '2rem',
          }}
        >
          <h2
            style={{
              fontSize: '2rem',
              fontWeight: 'bold',
              color: 'var(--accent, #FFC700)',
            }}
          >
            Oops! Something went wrong.
          </h2>
          <p style={{ marginTop: '1rem', color: 'var(--text-muted, #A1A1AA)' }} aria-live="polite">
            We've encountered an unexpected error. Our team has been notified.
          </p>
          {this.state.error && (
            <pre
              style={{
                marginTop: '1rem',
                maxWidth: 'min(680px, 100%)',
                overflowX: 'auto',
                textAlign: 'left',
                color: 'var(--text-muted, #A1A1AA)',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: '1rem',
                padding: '1rem',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <div
            style={{
              marginTop: '2rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid var(--border, #333)',
                borderRadius: '9999px',
                background: 'var(--surface-soft, #1F2937)',
                color: 'var(--text-primary, #FFF)',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid transparent',
                borderRadius: '9999px',
                background: 'var(--accent, #FFC700)',
                color: 'black',
                cursor: 'pointer',
              }}
            >
              Reload App
            </button>
            <a
              href="/"
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '9999px',
                background: 'rgba(255,255,255,0.12)',
                color: 'var(--text-primary, #FFF)',
                textDecoration: 'none',
              }}
            >
              Go Home
            </a>
          </div>
        </div>
      )
    }

    return <div key={this.state.resetKey}>{this.props.children}</div>
  }
}

export default ErrorBoundary
