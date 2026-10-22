import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  path: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps the sidebar and the rest of the app usable when a page cannot be shown in the editor. */
export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Could not show ${this.props.path} in the editor`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-error" role="alert" data-testid="page-error">
        <p className="page-error-title">This page couldn&apos;t be shown in the editor.</p>
        <p>
          Its file is unchanged: <code>{this.props.path}</code>
        </p>
        <p className="page-error-detail">{this.state.error.message}</p>
      </div>
    )
  }
}
