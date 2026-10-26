import { useEffect, useState } from 'react'

/**
 * One highlight for a suggestion menu, moved by both the pointer and the arrow keys, as in Notion.
 * BlockNote's own index ignores the pointer, so its keys are taken first, in the capture phase.
 */
export function useSuggestionKeys<T extends { key: string; disabled?: boolean }>(
  items: T[],
  onItemClick: ((item: T) => void) | undefined
): { active: number; setActive: (index: number) => void } {
  const [active, setActive] = useState(0)
  // BlockNote reloads the same list whenever the editor re-renders; only a different list resets.
  const keys = items.map((item) => item.key).join('\n')
  const [shownKeys, setShownKeys] = useState(keys)
  if (shownKeys !== keys) {
    setShownKeys(keys)
    setActive(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (items.length === 0 || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((from) => {
          for (let n = 1; n <= items.length; n++) {
            const i = (((from + step * n) % items.length) + items.length) % items.length
            if (!items[i].disabled) return i
          }
          return from
        })
      } else if (e.key === 'Enter') {
        const item = items[Math.min(active, items.length - 1)]
        if (item !== undefined && !item.disabled) onItemClick?.(item)
      } else {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [items, active, onItemClick])

  return { active, setActive }
}
