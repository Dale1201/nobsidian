import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../workspace/fs-utils'

interface Price {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

// Dollars per million tokens, from Anthropic's pricing page on 2026-10-26. The models after
// the first three are ones a refusal fallback may answer with.
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'claude-haiku-5-5': { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 }
}

// An unknown model is priced at the dearest known rates, so the total never reads low.
const UNKNOWN: Price = PRICES['claude-fable-5-1']

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export interface MonthUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  dollars: number
}

export function costOf(model: string, usage: Usage): number {
  const price = PRICES[model] ?? UNKNOWN
  const tokens =
    usage.input_tokens * price.input +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    usage.output_tokens * price.output
  return tokens / 1_000_000
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const EMPTY: MonthUsage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  dollars: 0
}

/** Token counts and dollars per month, kept on this Mac. */
export class UsageLedger {
  private months: Record<string, MonthUsage> | null = null

  constructor(private readonly file: string) {}

  private async load(): Promise<Record<string, MonthUsage>> {
    if (this.months) return this.months
    const parsed: unknown = await readFile(this.file, 'utf8')
      .then(JSON.parse)
      .catch(() => null)
    const plain = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    this.months = plain ? (parsed as Record<string, MonthUsage>) : {}
    return this.months
  }

  async month(date = new Date()): Promise<MonthUsage> {
    return (await this.load())[monthKey(date)] ?? { ...EMPTY }
  }

  async add(model: string, usage: Usage, date = new Date()): Promise<void> {
    const months = await this.load()
    const key = monthKey(date)
    const m = months[key] ?? { ...EMPTY }
    months[key] = {
      requests: m.requests + 1,
      inputTokens: m.inputTokens + usage.input_tokens,
      outputTokens: m.outputTokens + usage.output_tokens,
      cacheWriteTokens: m.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
      cacheReadTokens: m.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
      dollars: m.dollars + costOf(model, usage)
    }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(months, null, 2) + '\n')
  }
}
