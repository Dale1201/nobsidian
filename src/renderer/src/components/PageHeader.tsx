import { useState } from 'react'
import type { PageMetaPatch } from '@shared/types'
import type { PageMeta } from '@shared/core/page'
import { resolveAssetUrl } from '../lib/assets'
import { ImageIcon, SmileIcon } from './icons'
import { IconPicker } from '../editor/IconPicker'
import { Popover } from './Popover'

const api = window.api
const STARTER_ICONS = ['📄', '📝', '💡', '🚀', '📚', '🌱', '🎯', '🗂️', '✨', '🧭']

export function PageCover({
  meta,
  onChange
}: {
  meta: PageMeta
  onChange: (patch: PageMetaPatch) => void
}): React.JSX.Element | null {
  const [position, setPosition] = useState<number | null>(null)
  if (!meta.cover) return null
  const current = position ?? meta.coverPosition ?? 50

  const startDrag = (e: React.MouseEvent<HTMLImageElement>): void => {
    if (position === null) return
    e.preventDefault()
    const startY = e.clientY
    const start = current
    const height = e.currentTarget.getBoundingClientRect().height
    const move = (ev: MouseEvent): void =>
      setPosition(Math.max(0, Math.min(100, start - ((ev.clientY - startY) / height) * 100)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="page-cover" data-testid="page-cover">
      <img
        src={resolveAssetUrl(meta.cover)}
        alt=""
        draggable={false}
        style={{
          objectPosition: `center ${current}%`,
          cursor: position === null ? 'default' : 'move'
        }}
        onMouseDown={startDrag}
      />
      <div
        className="page-cover-actions"
        style={position === null ? undefined : { display: 'flex' }}
      >
        {position === null ? (
          <>
            <button
              className="cover-button"
              onClick={async () => {
                const cover = await api.invoke('attachment:chooseImage', undefined)
                if (cover) onChange({ cover, coverPosition: 50 })
              }}
            >
              Change cover
            </button>
            <button className="cover-button" onClick={() => setPosition(current)}>
              Reposition
            </button>
            <button
              className="cover-button"
              onClick={() => onChange({ cover: null, coverPosition: null })}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <button
              className="cover-button"
              onClick={() => {
                onChange({ coverPosition: Math.round(current) })
                setPosition(null)
              }}
            >
              Save position
            </button>
            <button className="cover-button" onClick={() => setPosition(null)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function PageIconAndControls({
  meta,
  onChange
}: {
  meta: PageMeta
  onChange: (patch: PageMetaPatch) => void
}): React.JSX.Element {
  const [picker, setPicker] = useState<DOMRect | null>(null)

  const chooseCover = async (): Promise<void> => {
    const cover = await api.invoke('attachment:chooseImage', undefined)
    if (cover) onChange({ cover, coverPosition: 50 })
  }

  return (
    <>
      {meta.icon && (
        <button
          className="page-header-icon"
          aria-label="Change icon"
          data-testid="page-icon"
          onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
        >
          {meta.icon.startsWith('/') ? <img src={resolveAssetUrl(meta.icon)} alt="" /> : meta.icon}
        </button>
      )}
      <div className="page-header-controls">
        {!meta.icon && (
          <button
            className="page-header-control"
            onClick={() =>
              onChange({ icon: STARTER_ICONS[Math.floor(Math.random() * STARTER_ICONS.length)] })
            }
          >
            <SmileIcon size={16} /> Add icon
          </button>
        )}
        {!meta.cover && (
          <button className="page-header-control" onClick={() => void chooseCover()}>
            <ImageIcon size={16} /> Add cover
          </button>
        )}
      </div>
      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)} className="icon-picker">
          <div className="icon-picker-bar">
            <button
              className="page-header-control"
              onClick={async () => {
                const icon = await api.invoke('attachment:chooseImage', undefined)
                if (icon) onChange({ icon })
                setPicker(null)
              }}
            >
              Upload
            </button>
            <button
              className="page-header-control"
              onClick={() => {
                onChange({ icon: null })
                setPicker(null)
              }}
            >
              Remove
            </button>
          </div>
          <IconPicker
            onSelect={(emoji) => {
              onChange({ icon: emoji })
              setPicker(null)
            }}
          />
        </Popover>
      )}
    </>
  )
}
