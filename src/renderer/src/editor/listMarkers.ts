const BULLETS = ['•', '◦', '▪']

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i']
]

export function bulletMarker(depth: number): string {
  return BULLETS[depth % 3]
}

export function numberMarker(index: number, depth: number): string {
  const level = depth % 3
  if (level === 1) return `${letters(index)}.`
  if (level === 2) return `${roman(index)}.`
  return `${index}.`
}

function letters(n: number): string {
  let out = ''
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
    out = String.fromCharCode(97 + ((k - 1) % 26)) + out
  }
  return out
}

function roman(n: number): string {
  let out = ''
  let rest = n
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits
      rest -= value
    }
  }
  return out
}
