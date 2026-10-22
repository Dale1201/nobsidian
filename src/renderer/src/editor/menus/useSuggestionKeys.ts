import { useEffect, useState } from 'react'

/**
 * One highlight for a suggestion menu, moved by both the pointer and the arrow keys, as in Notion.
 * BlockNote's own index ignores the pointer, so its keys are taken first, in the capture phase.
 */
export function useSuggestionKeys<T>(
  items: T[],
  onItemClick: ((item: T) => void) | undefined
): { active: number; setActive: (index: number) => void } {
  const [active, setActive] = useState(0)
  const [shownItems, setShownItems] = useState(items)
  if (shownItems !== items) {
    setShownItems(items)
    setActive(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (items.length === 0 || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((i) => (i + step + items.length) % items.length)
      } else if (e.key === 'Enter') {
        const item = items[Math.min(active, items.length - 1)]
        if (item !== undefined) onItemClick?.(item)
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
