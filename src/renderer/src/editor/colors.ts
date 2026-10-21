import { createContext } from 'react'

export type ColorKind = 'text' | 'background'
export type PickedColor = { kind: ColorKind; color: string }

/** Told about every color picked in the toolbar, so Cmd+Shift+H can reapply it. */
export const ColorPickContext = createContext<(picked: PickedColor) => void>(() => {})
