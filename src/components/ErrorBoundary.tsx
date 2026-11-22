import { Component, type ReactNode } from 'react'

/** Keeps one broken view from blanking the app: shows the error and lets the user retry. */
export class ErrorBoundary extends Component<{ children: ReactNode; area: string }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
        <div className="font-medium">The {this.props.area} hit an error and stopped.</div>
        <code className="code block break-all">{this.state.error.message}</code>
        <p>Check the configuration values (for example an endpoint that is not a full URL), then try again.</p>
        <button type="button" className="btn-secondary text-xs" onClick={() => this.setState({ error: undefined })}>
          Try again
        </button>
      </div>
    )
  }
}
