import './icon-picker.css'

import { EmojiPicker, type Emoji } from 'frimousse'
import { resolveLocalEmojiData } from './emojiData'

export type IconPickerProps = {
  onSelect(emoji: string): void
}

export function IconPicker(props: IconPickerProps): React.JSX.Element {
  return (
    <EmojiPicker.Root
      className="nb-icon-picker"
      columns={12}
      resolveEmojiData={resolveLocalEmojiData}
      onEmojiSelect={(emoji: Emoji) => props.onSelect(emoji.emoji)}
    >
      <EmojiPicker.Search className="nb-icon-picker-search" placeholder="Filter…" autoFocus />
      <EmojiPicker.Viewport className="nb-icon-picker-viewport">
        <EmojiPicker.Loading className="nb-icon-picker-status">Loading…</EmojiPicker.Loading>
        <EmojiPicker.Empty className="nb-icon-picker-status">No emoji found.</EmojiPicker.Empty>
        <EmojiPicker.List
          className="nb-icon-picker-list"
          components={{
            CategoryHeader: ({ category, ...rest }) => (
              <div className="nb-icon-picker-category" {...rest}>
                {category.label}
              </div>
            ),
            Row: ({ children, ...rest }) => (
              <div className="nb-icon-picker-row" {...rest}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...rest }) => (
              <button className="nb-icon-picker-emoji" {...rest}>
                {emoji.emoji}
              </button>
            )
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  )
}
