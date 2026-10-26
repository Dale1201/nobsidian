import { useState } from 'react'
import { useAi } from './aiStore'

/** Pasting and checking a key, or showing the one that is saved. */
export function KeyField({ onSaved }: { onSaved?: () => void }): React.JSX.Element {
  const status = useAi((s) => s.status)
  const [key, setKey] = useState('')
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'checking' } | { kind: 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  if (status && !status.encryptionAvailable) {
    return (
      <div className="settings-key-note">
        This Mac can&apos;t store the key safely, so AI can&apos;t be set up.
      </div>
    )
  }
  if (status?.hasKey) {
    return (
      <div className="settings-key">
        <span className="settings-key-hint">{status.keyHint}</span>
        {state.kind === 'saved' && <span className="settings-key-ok">✓ Key works</span>}
        <button
          type="button"
          className="button-secondary settings-button"
          onClick={() => {
            setState({ kind: 'idle' })
            void useAi.getState().clearKey()
          }}
        >
          Remove
        </button>
      </div>
    )
  }
  const save = async (): Promise<void> => {
    setState({ kind: 'checking' })
    const result = await useAi.getState().setKey(key)
    if (!result.ok) return setState({ kind: 'error', message: result.error })
    setKey('')
    setState({ kind: 'saved' })
    onSaved?.()
  }
  return (
    <div className="settings-key-entry">
      <form
        className="settings-key"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim() && state.kind !== 'checking') void save()
        }}
      >
        <input
          type="password"
          className="settings-input"
          aria-label="Anthropic API key"
          placeholder="Paste your API key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            if (state.kind === 'error') setState({ kind: 'idle' })
          }}
        />
        <button
          type="submit"
          className="button-primary settings-button"
          disabled={!key.trim() || state.kind === 'checking'}
        >
          {state.kind === 'checking' ? 'Checking…' : 'Save'}
        </button>
      </form>
      {state.kind === 'error' && (
        <div className="settings-key-error" role="alert">
          {state.message}
        </div>
      )}
    </div>
  )
}
