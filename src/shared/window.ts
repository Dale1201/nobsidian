export const TAB_BAR_HEIGHT = 36

export interface WindowControls {
  /** Where the traffic lights go, as BrowserWindow's trafficLightPosition. */
  x: number
  y: number
  /** Width the traffic lights take at the left of the tab bar. */
  inset: number
}

/** macOS 26 draws bigger traffic lights; these are the sizes Notion's tab bar uses. */
export function windowControls(macosVersion: string): WindowControls {
  const large = parseInt(macosVersion.split('.')[0], 10) >= 26
  const size = large ? 14 : 12
  const gap = large ? 9 : 8
  return {
    x: size,
    y: Math.round((TAB_BAR_HEIGHT - size) / 2),
    inset: 3 * size + 2 * gap + 1.5 * size
  }
}
