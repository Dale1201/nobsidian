import { useEffect, useState } from 'react'
import { ATTACH_FILES_EVENT } from '../editor/attachFiles'
import { useApp } from '../store'
import { ConfirmDialog } from './Modal'

const api = window.api

interface Pending {
  paths: string[]
  /** Dropped into the editor, where a zip is otherwise attached as a file. */
  files: File[] | null
}

const isZip = (file: File): boolean => /\.zip$/i.test(file.name)
const inEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('.bn-editor') !== null
// Notion names its exports `<id>_ExportBlock-<id>.zip` or `Export-<id>.zip`.
const notionName = (file: File): boolean => /export/i.test(file.name)
const hasZip = (e: DragEvent): boolean =>
  [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && /zip/.test(i.type))

/** Zips dropped on the window start a Notion import once their contents look like one. */
export function ImportDrop(): React.JSX.Element | null {
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      if (!hasZip(e) || inEditor(e.target)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length === 0 || !files.every(isZip)) return
      const editor = inEditor(e.target)
      // Other zips dropped into a page are attached as before.
      if (editor && !files.every(notionName)) return
      e.preventDefault()
      e.stopPropagation()
      void check(files, editor)
    }
    const check = async (files: File[], editor: boolean): Promise<void> => {
      const app = useApp.getState()
      if (!app.workspace) return
      const paths = files.map((f) => api.pathForFile(f))
      const kinds = await api.invoke('import:peek', { paths }).catch(() => null)
      if (!kinds) return
      const notion = paths.filter((_, i) => kinds[i] === 'notion-html')
      if (notion.length > 0) {
        setPending({ paths: notion, files: editor ? files : null })
      } else if (kinds.includes('notion-markdown')) {
        app.showMessage('This is a Markdown export. Export again as HTML.')
      } else if (editor) {
        attach(files)
      } else {
        app.showMessage("This zip isn't a Notion HTML export.")
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])

  if (!pending) return null
  const count = pending.paths.length
  return (
    <ConfirmDialog
      title={`Import ${count === 1 ? 'this file' : `${count} files`} from Notion?`}
      message="Its pages will be added under “Imported from Notion”."
      confirmLabel="Import"
      extra={
        pending.files
          ? { label: 'Attach as file', onSelect: () => attach(pending.files!) }
          : undefined
      }
      onConfirm={() => void useApp.getState().startImport(pending.paths)}
      onClose={() => setPending(null)}
    />
  )
}

function attach(files: File[]): void {
  window.dispatchEvent(new CustomEvent(ATTACH_FILES_EVENT, { detail: files }))
}
