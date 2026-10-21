import katex from 'katex'
import { useLayoutEffect, useRef } from 'react'

// katex.render builds DOM and sets styles through CSSOM, which a `default-src 'self'`
// CSP allows; renderToString + innerHTML relies on style attributes, which it blocks.
export function Katex(props: { latex: string; displayMode: boolean }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    katex.render(props.latex, ref.current, {
      displayMode: props.displayMode,
      throwOnError: false
    })
  }, [props.latex, props.displayMode])
  return <span ref={ref} />
}
