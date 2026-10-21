import { resolveAssetUrl } from '../lib/assets'
import { PageIcon } from './icons'

/** Emoji, uploaded image, or the default document glyph. */
export function PageIconView({
  icon,
  size = 16
}: {
  icon?: string
  size?: number
}): React.JSX.Element {
  if (!icon) return <PageIcon size={size + 2} />
  if (icon.startsWith('/')) return <img src={resolveAssetUrl(icon)} alt="" />
  return <span>{icon}</span>
}
