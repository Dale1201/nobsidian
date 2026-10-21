const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Today, 2:03 PM", "Yesterday, 9:12 AM", "Oct 12, 9:12 AM", or with the year if not this year. */
export function versionLabel(iso: string, now = new Date(), seconds = false): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {})
  })
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const sameYear = date.getFullYear() === now.getFullYear()
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
  return `${day}, ${time}`
}

/** Labels for a list of versions; ones that would read the same as a neighbor show seconds. */
export function versionLabels(isos: string[], now = new Date()): string[] {
  const plain = isos.map((iso) => versionLabel(iso, now))
  return isos.map((iso, i) =>
    plain[i] === plain[i - 1] || plain[i] === plain[i + 1] ? versionLabel(iso, now, true) : plain[i]
  )
}

/** "Just now", "5 minutes ago", "3 hours ago", "Yesterday", "4 days ago". */
export function timeAgo(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS)
  return days <= 1 ? 'Yesterday' : `${days} days ago`
}
