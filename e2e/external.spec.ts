import { readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { newPage, waitForFile } from './helpers'

test('pages added, renamed and deleted in Finder show up in the sidebar', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Anchor')
  await writeFile(join(workspace, 'From Finder.md'), 'Hello\n')
  await expect(page.getByTestId('sidebar-row-From Finder')).toBeVisible()
  await rename(join(workspace, 'From Finder.md'), join(workspace, 'Renamed in Finder.md'))
  await expect(page.getByTestId('sidebar-row-Renamed in Finder')).toBeVisible()
  await expect(page.getByTestId('sidebar-row-From Finder')).toHaveCount(0)
  await unlink(join(workspace, 'Renamed in Finder.md'))
  await expect(page.getByTestId('sidebar-row-Renamed in Finder')).toHaveCount(0)
})

test('a notes folder that disappears while open shows the locate screen', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Anything')
  await page.keyboard.type('Some words')
  await waitForFile(join(workspace, 'Anything.md'), 'Some words')
  await rm(workspace, { recursive: true, force: true })
  await expect(page.getByRole('heading', { name: "Can't find your notes" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Locate folder' })).toBeVisible()
  await expect
    .poll(
      () =>
        readdir(workspace).then(
          () => 'exists',
          () => 'gone'
        ),
      { timeout: 3000 }
    )
    .toBe('gone')
})
