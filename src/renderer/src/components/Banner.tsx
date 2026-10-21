/** A full-width notice under the top bar: page in Trash, changed outside the app, bad frontmatter. */
export function Banner({
  tone,
  message,
  actions = []
}: {
  tone: 'danger' | 'warning' | 'info'
  message: string
  actions?: { label: string; onClick: () => void }[]
}): React.JSX.Element {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <span>{message}</span>
      {actions.map((a) => (
        <button key={a.label} className="banner-button" onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
