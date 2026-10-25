import './drawing.css'

import { ASSET_SCHEME, EXCALIDRAW_HOST } from '@shared/ipc'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { errorReason } from '../store'
import { DrawingFrame } from './DrawingFrame'
import type { DrawingSession } from './session'

// Excalidraw reads this when it loads; the main process serves the fonts the build copied.
window.EXCALIDRAW_ASSET_PATH = `${ASSET_SCHEME}://${EXCALIDRAW_HOST}/`

const DrawingEditor = lazy(() => import('./DrawingEditor'))

/** A failure to load or render Excalidraw closes only the drawing, not the whole window. */
class DrawingErrorBoundary extends Component<
  { session: DrawingSession; children: ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <DrawingFrame
        error={`Couldn't open the drawing editor: ${errorReason(this.state.error)}`}
        onDone={() => this.props.session.close()}
      />
    )
  }
}

export function DrawingHost({
  session,
  theme
}: {
  session: DrawingSession
  theme: 'light' | 'dark'
}): React.JSX.Element {
  return (
    <DrawingErrorBoundary session={session}>
      <Suspense fallback={<DrawingFrame busy onDone={() => {}} />}>
        <DrawingEditor session={session} theme={theme} />
      </Suspense>
    </DrawingErrorBoundary>
  )
}
