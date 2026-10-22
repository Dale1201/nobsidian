import type { ImportProgress, ImportStatus } from '@shared/types'
import { useApp } from '../store'
import { CloseIcon } from './icons'

function progressLine(p: ImportProgress): string {
  if (p.phase === 'reading') return 'Reading export…'
  if (p.phase === 'finishing') return 'Finishing…'
  const what = p.phase === 'converting' ? 'Converting pages' : 'Copying images and files'
  return `${what} · ${p.done} of ${p.total}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function summary(status: Exclude<ImportStatus, { state: 'running' }>): string {
  if (status.state === 'cancelled') return 'Cancelled, nothing was imported.'
  if (status.state === 'failed') return status.message
  const pages = `Imported ${plural(status.pages, 'page', 'pages')}.`
  if (status.issues === 0) return pages
  return `${pages} ${plural(status.issues, 'thing needs', 'things need')} a look.`
}

/** Lifts messages (`.toast`) above the panel while it shows, so the two never overlap. */
function liftMessages(panel: HTMLDivElement | null): (() => void) | undefined {
  if (!panel) return
  const root = document.documentElement.style
  const update = (): void => root.setProperty('--import-panel-lift', `${panel.offsetHeight + 12}px`)
  update()
  const observer = new ResizeObserver(update)
  observer.observe(panel)
  return () => {
    observer.disconnect()
    root.removeProperty('--import-panel-lift')
  }
}

/** The bottom-right card that follows a Notion import; editing carries on underneath it. */
export function ImportPanel(): React.JSX.Element | null {
  const status = useApp((s) => s.importStatus)
  if (!status) return null
  const app = useApp.getState
  const dismiss = (): void => app().setImportStatus(null)
  const open = (id: string, rootId: string): void => {
    void app().setExpanded(rootId, true)
    app().openPage(id)
    dismiss()
  }

  if (status.state === 'running') {
    const p = status.progress
    const fraction = p.total > 0 ? p.done / p.total : null
    return (
      <div ref={liftMessages} className="import-panel" role="status" aria-live="polite">
        <div className="import-panel-title">Importing from Notion</div>
        <div className="import-panel-line">{progressLine(p)}</div>
        <div className="import-panel-bar">
          <div
            className={fraction === null ? 'import-panel-fill indeterminate' : 'import-panel-fill'}
            style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
        {p.phase !== 'finishing' && (
          <div className="import-panel-actions">
            <button className="button-secondary" onClick={() => void app().cancelImport()}>
              Cancel
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={liftMessages}
      className={status.state === 'failed' ? 'import-panel failed' : 'import-panel'}
      role={status.state === 'failed' ? 'alert' : 'status'}
    >
      <div className="import-panel-head">
        <div className="import-panel-title">
          {status.state === 'failed' ? "Couldn't import from Notion" : 'Import from Notion'}
        </div>
        <button className="icon-button" aria-label="Dismiss" onClick={dismiss}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="import-panel-line">{summary(status)}</div>
      {status.state === 'done' && (
        <div className="import-panel-actions">
          <button className="button-primary" onClick={() => open(status.rootId, status.rootId)}>
            Open
          </button>
          <button className="button-secondary" onClick={() => open(status.reportId, status.rootId)}>
            Open report
          </button>
        </div>
      )}
    </div>
  )
}
