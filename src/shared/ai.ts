export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5'

export const DEFAULT_AI_MODEL: AiModel = 'claude-opus-5-5'

export const AI_MODELS: { id: AiModel; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
]

export function isAiModel(value: unknown): value is AiModel {
  return AI_MODELS.some((m) => m.id === value)
}

/** Where a result lands: over the selection, after it, at the cursor, over the page body, or in the popup. */
export type SkillKind = 'edit' | 'insertBelow' | 'insertAtCursor' | 'editPage' | 'reply'

export type SkillId =
  | 'improve'
  | 'proofread'
  | 'shorter'
  | 'longer'
  | 'simplify'
  | 'tone'
  | 'translate'
  | 'summarize'
  | 'explain'
  | 'continue'
  | 'summarizePage'
  | 'translatePage'

export interface Skill {
  id: SkillId
  label: string
  kind: SkillKind
  selection: boolean
  /** Text put in the prompt for the user to finish, instead of running at once. */
  prefill?: string
  instruction: string
}

export const SKILLS: Skill[] = [
  {
    id: 'improve',
    label: 'Improve writing',
    kind: 'edit',
    selection: true,
    instruction:
      'Improve the writing of the selection: make it clearer and tighter while keeping its meaning, language and formatting.'
  },
  {
    id: 'proofread',
    label: 'Proofread',
    kind: 'edit',
    selection: true,
    instruction:
      'Fix spelling, grammar and punctuation in the selection. Change nothing else, and keep it word for word where it is already correct.'
  },
  {
    id: 'shorter',
    label: 'Make shorter',
    kind: 'edit',
    selection: true,
    instruction: 'Make the selection about half as long, keeping every key point.'
  },
  {
    id: 'longer',
    label: 'Make longer',
    kind: 'edit',
    selection: true,
    instruction:
      'Make the selection longer, adding detail that follows from the page. Do not invent facts.'
  },
  {
    id: 'simplify',
    label: 'Simplify language',
    kind: 'edit',
    selection: true,
    instruction: 'Rewrite the selection in plain words and short sentences.'
  },
  {
    id: 'tone',
    label: 'Change tone to…',
    kind: 'edit',
    selection: true,
    prefill: 'Change tone to ',
    instruction: ''
  },
  {
    id: 'translate',
    label: 'Translate to…',
    kind: 'edit',
    selection: true,
    prefill: 'Translate to ',
    instruction: ''
  },
  {
    id: 'summarize',
    label: 'Summarize',
    kind: 'insertBelow',
    selection: true,
    instruction: 'Write a short summary of the selection. It will be inserted after the selection.'
  },
  {
    id: 'explain',
    label: 'Explain',
    kind: 'reply',
    selection: true,
    instruction: 'Explain the selection in a few sentences for someone reading this page.'
  },
  {
    id: 'continue',
    label: 'Continue writing',
    kind: 'insertAtCursor',
    selection: false,
    instruction:
      'Continue writing from the cursor in the voice and format of the page. Write a paragraph or two.'
  },
  {
    id: 'summarizePage',
    label: 'Summarize page',
    kind: 'insertAtCursor',
    selection: false,
    instruction: 'Write a short summary of the whole page. It will be inserted at the cursor.'
  },
  {
    id: 'translatePage',
    label: 'Translate page to…',
    kind: 'editPage',
    selection: false,
    prefill: 'Translate page to ',
    instruction: ''
  }
]

export function skill(id: SkillId): Skill {
  return SKILLS.find((s) => s.id === id)!
}

/** How the main process asks for a result, and how its text arrives. */
export type AiMode = 'edit' | 'insert' | 'reply'

export function modeOf(kind: SkillKind): AiMode {
  if (kind === 'reply') return 'reply'
  return kind === 'edit' || kind === 'editPage' ? 'edit' : 'insert'
}

/** Marks the selection and the cursor in the page Markdown sent to Claude. */
export const SELECTION_START = '⟦selection⟧'
export const SELECTION_END = '⟦/selection⟧'
export const CURSOR = '⟦cursor⟧'

export interface AiStart {
  /** One per open Writer; follow-ups in it share the conversation. */
  sessionId: string
  requestId: string
  title: string
  /** The page as Markdown, with the selection or cursor marked. */
  markdown: string
  /** What the user asked: a skill's id with any finished prefill, or free text. */
  skill?: SkillId
  instruction?: string
  /** Free text sent after a result, revising it. */
  followUp?: boolean
  /** For free text: whether Claude may edit a selection, or only insert at the cursor. */
  selection: boolean
}

export type AiErrorKind = 'auth' | 'rate' | 'busy' | 'network' | 'request' | 'refusal' | 'truncated'

export interface AiError {
  kind: AiErrorKind
  message: string
}

export interface AiStatus {
  hasKey: boolean
  keyHint: string | null
  month: { requests: number; dollars: number }
}

export type AiKeyResult = { ok: true } | { ok: false; error: string }
