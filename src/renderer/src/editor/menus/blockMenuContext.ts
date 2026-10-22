import { createContext } from 'react'

export interface BlockMenuApi {
  open(ids: string[], anchor: DOMRect): void
}

export const BlockMenuContext = createContext<BlockMenuApi>({ open: () => {} })
