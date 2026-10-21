import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      focusable={false}
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ChevronRightIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7.4 4.6a.75.75 0 0 1 1.06 0l4.87 4.87a.75.75 0 0 1 0 1.06L8.46 15.4a.75.75 0 1 1-1.06-1.06L11.74 10 7.4 5.66a.75.75 0 0 1 0-1.06Z" />
  </Svg>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M10 3.75a.75.75 0 0 1 .75.75v4.75h4.75a.75.75 0 0 1 0 1.5h-4.75v4.75a.75.75 0 0 1-1.5 0v-4.75H4.5a.75.75 0 0 1 0-1.5h4.75V4.5a.75.75 0 0 1 .75-.75Z" />
  </Svg>
)

export const DotsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="4.5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15.5" cy="10" r="1.5" />
  </Svg>
)

export const StarIcon = ({ filled, ...p }: IconProps & { filled?: boolean }): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M10 2.9l2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.7 5.7 16l.9-4.8L3.1 7.9l4.8-.6L10 2.9Z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </Svg>
)

export const PageIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M5.5 2.75h5.69c.2 0 .39.08.53.22l3.31 3.31c.14.14.22.33.22.53v9.44c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25V4c0-.69.56-1.25 1.25-1.25Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <path
      d="M7 10h6M7 12.75h6M7 7.25h3"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </Svg>
)

export const ComposeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.75 5.5c0-.41.34-.75.75-.75h4a.75.75 0 0 0 0-1.5h-4A2.25 2.25 0 0 0 3.25 5.5v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-4a.75.75 0 0 0-1.5 0v4c0 .41-.34.75-.75.75h-9a.75.75 0 0 1-.75-.75v-9Z" />
    <path d="M14.47 2.97a1.75 1.75 0 0 1 2.48 2.48l-6.2 6.2-3.1.62.62-3.1 6.2-6.2Z" />
  </Svg>
)

export const SmileIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="7.75" cy="8.5" r="1" />
    <circle cx="12.25" cy="8.5" r="1" />
    <path
      d="M7.25 11.75c.6.9 1.6 1.5 2.75 1.5s2.15-.6 2.75-1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </Svg>
)

export const ImageIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect
      x="3.25"
      y="4.25"
      width="13.5"
      height="11.5"
      rx="1.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="7.5" cy="8.25" r="1.25" />
    <path
      d="M4 14.5l3.75-3.75 2.5 2.5 2-2 3.75 3.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </Svg>
)

export const SidebarIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect
      x="3.25"
      y="4.25"
      width="13.5"
      height="11.5"
      rx="1.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path d="M8 4.5v11" stroke="currentColor" strokeWidth="1.4" />
  </Svg>
)

export const TrashIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M8 3.25h4M4.5 5.75h11M6 5.75l.6 9.1c.05.79.7 1.4 1.5 1.4h3.8c.8 0 1.45-.61 1.5-1.4l.6-9.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </Svg>
)
