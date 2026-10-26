import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { GOOD_KEY } from './fakeAnthropic'
import { expect, test } from './fixtures'

/** Starts a request from the renderer and collects the events it gets back. */
async function run(page: Page, instruction: string | null): Promise<string[]> {
  return page.evaluate(async (instruction) => {
    const requestId = crypto.randomUUID()
    const events: string[] = []
    const done = new Promise<void>((resolve) => {
      const offs = [
        window.api.on('ai:delta', (d) => {
          if (d.requestId === requestId) events.push(`${d.mode}:${d.text}`)
        }),
        window.api.on('ai:done', (d) => {
          if (d.requestId !== requestId) return
          events.push('done')
          offs.forEach((off) => off())
          resolve()
        }),
        window.api.on('ai:error', (d) => {
          if (d.requestId !== requestId) return
          events.push(`error:${d.kind}`)
          offs.forEach((off) => off())
          resolve()
        })
      ]
    })
    await window.api.invoke('ai:start', {
      sessionId: 's',
      requestId,
      title: 'Notes',
      markdown: '⟦selection⟧Long words.⟦/selection⟧',
      selection: true,
      ...(instruction ? { instruction } : { skill: 'shorter' as const })
    })
    await done
    return events
  }, instruction)
}

test('the main process streams Claude to the renderer and keeps the key to itself', async ({
  nb,
  anthropic
}) => {
  const { page } = nb
  expect(await page.evaluate(() => window.api.invoke('ai:status', undefined))).toMatchObject({
    hasKey: false,
    month: { requests: 0 }
  })
  expect(await run(page, null)).toEqual(['error:auth'])

  const saved = await page.evaluate((key) => window.api.invoke('ai:setKey', { key }), GOOD_KEY)
  expect(saved).toEqual({ ok: true })

  anthropic.reply({ text: 'Short.', chunks: 2 })
  expect(await run(page, null)).toEqual(['edit:Sho', 'edit:Short.', 'done'])
  anthropic.reply({ tool: { name: 'reply', markdown: 'It means brief.' }, chunks: 1 })
  expect(await run(page, 'what does it mean?')).toEqual(['reply:It means brief.', 'done'])

  const status = await page.evaluate(() => window.api.invoke('ai:status', undefined))
  expect(status).toMatchObject({ hasKey: true, keyHint: 'sk-ant-…a1b2', month: { requests: 2 } })
  expect(JSON.stringify(status)).not.toContain(GOOD_KEY)

  // Neither the settings, nor the notes folder, nor what the renderer can read hold the key.
  expect(await readFile(join(nb.userData, 'settings.json'), 'utf8')).not.toContain(GOOD_KEY)
  for (const name of await readdir(nb.userData)) {
    const text = await readFile(join(nb.userData, name), 'utf8').catch(() => '')
    if (name !== 'anthropic-key.bin') expect(text).not.toContain(GOOD_KEY)
  }
  for (const name of await readdir(nb.workspace, { recursive: true })) {
    const text = await readFile(join(nb.workspace, name), 'utf8').catch(() => '')
    expect(text).not.toContain(GOOD_KEY)
  }
  const settings = await page.evaluate(() => window.api.invoke('settings:get', undefined))
  expect(JSON.stringify(settings)).not.toContain(GOOD_KEY)
  expect(settings.ai).toEqual({ enabled: true, model: 'claude-opus-5-5' })

  // The key survives a restart.
  const again = await nb.relaunch()
  expect(await again.evaluate(() => window.api.invoke('ai:status', undefined))).toMatchObject({
    hasKey: true
  })
})
