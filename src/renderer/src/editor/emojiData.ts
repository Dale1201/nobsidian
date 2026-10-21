import type { Emoji as EmojibaseEmoji, MessagesDataset } from 'emojibase'
import type { EmojiData, EmojiDataResolver } from 'frimousse'

type SkinToneKey = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark'
type SkinTones = Record<SkinToneKey, string>

const TONE_KEYS: (SkinToneKey | undefined)[] = [
  undefined,
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark'
]

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

let canvas: CanvasRenderingContext2D | null | undefined

// Same technique as frimousse's default resolver: an emoji the OS font can't draw
// renders as monochrome tofu, so blue and red fills produce identical pixels.
function rendersAsColorEmoji(emoji: string): boolean {
  canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!canvas) return true
  const size = 2
  canvas.canvas.width = size
  canvas.canvas.height = size
  canvas.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  canvas.textBaseline = 'middle'
  if (canvas.measureText(emoji).width >= size * 2) return false
  canvas.fillStyle = '#00f'
  canvas.fillText(emoji, 0, 0)
  const blue = canvas.getImageData(0, 0, size, size).data
  canvas.clearRect(0, 0, size, size)
  canvas.fillStyle = '#f00'
  canvas.fillText(emoji, 0, 0)
  const red = canvas.getImageData(0, 0, size, size).data
  canvas.clearRect(0, 0, size, size)
  for (let i = 0; i < blue.length; i += 4) {
    if (blue[i] !== red[i] || blue[i + 1] !== red[i + 1] || blue[i + 2] !== red[i + 2]) {
      return false
    }
  }
  return true
}

function newestSupportedVersion(emojis: EmojibaseEmoji[]): number {
  const firstOfVersion = new Map<number, string>()
  for (const e of emojis) if (!firstOfVersion.has(e.version)) firstOfVersion.set(e.version, e.emoji)
  const versions = [...firstOfVersion.keys()].sort((a, b) => b - a)
  return versions.find((v) => rendersAsColorEmoji(firstOfVersion.get(v)!)) ?? versions[0] ?? 0
}

export function toEmojiData(
  emojis: EmojibaseEmoji[],
  messages: MessagesDataset,
  options: { emojiVersion?: number; countryFlags?: boolean } = {}
): EmojiData {
  const flagSubgroups = new Set(
    messages.subgroups
      .filter((s) => s.key === 'country-flag' || s.key === 'subdivision-flag')
      .map((s) => s.order)
  )
  const maxVersion = options.emojiVersion ?? newestSupportedVersion(emojis)
  const countryFlags = options.countryFlags ?? rendersAsColorEmoji('🇪🇺')

  const skinTones = {} as SkinTones
  for (const tone of messages.skinTones) skinTones[tone.key] = capitalize(tone.message)

  // "component" (skin tone and hair swatches) is not a pickable category.
  const categories = messages.groups
    .filter((g) => g.key !== 'component')
    .map((g) => ({ index: g.order, label: capitalize(g.message) }))
  const categoryIndexes = new Set(categories.map((c) => c.index))

  return {
    locale: 'en',
    categories,
    skinTones,
    emojis: emojis
      .filter(
        (e) => e.group !== undefined && categoryIndexes.has(e.group) && e.version <= maxVersion
      )
      .filter((e) => countryFlags || !flagSubgroups.has(e.subgroup ?? -1))
      .map((e) => {
        const skins = {} as SkinTones
        const aliases: string[] = []
        for (const skin of e.skins ?? []) {
          const key = typeof skin.tone === 'number' ? TONE_KEYS[skin.tone] : undefined
          if (key) skins[key] = skin.emoji
          else aliases.push(skin.emoji)
        }
        return {
          emoji: e.emoji,
          category: e.group!,
          label: capitalize(e.label),
          version: e.version,
          tags: e.tags ?? [],
          skins: e.skins?.length ? skins : undefined,
          aliases: aliases.length ? aliases : undefined
        }
      })
  }
}

// Must be a stable module-level reference: frimousse caches results per resolver function.
// Dynamic imports keep the ~800 KB dataset out of the main chunk; Vite bundles it as a local asset.
export const resolveLocalEmojiData: EmojiDataResolver = async (
  _locale,
  { emojiVersion, signal }
) => {
  const [{ default: emojis }, { default: messages }] = await Promise.all([
    import('emojibase-data/en/data.json'),
    import('emojibase-data/en/messages.json')
  ])
  signal?.throwIfAborted()
  return toEmojiData(emojis as EmojibaseEmoji[], messages as MessagesDataset, { emojiVersion })
}
