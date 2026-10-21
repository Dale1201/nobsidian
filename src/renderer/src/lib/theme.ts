import { useEffect, useState } from 'react'
import type { ThemePreference } from '@shared/ipc'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function useEffectiveTheme(preference: ThemePreference | undefined): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(media.matches)
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const theme =
    preference === 'light' || preference === 'dark' ? preference : systemDark ? 'dark' : 'light'
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return theme
}

export function toggledPreference(current: 'light' | 'dark'): ThemePreference {
  return current === 'dark' ? 'light' : 'dark'
}
