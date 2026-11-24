import { test as base, expect, type Page } from '@playwright/test'

export type ConsoleOptions = {
  /** Set the mock's Jitter checkbox before the run; each Playwright project runs the suite with one value. */
  jitter: boolean
}

export const test = base.extend<ConsoleOptions>({
  jitter: [false, { option: true }],
})

export { expect }

export const card = (page: Page, id: string) => page.getByTestId(`agent-card-agent_${id}`)
export const badge = (page: Page, id: string) => card(page, id).getByTestId('agent-badge')
export const panel = (page: Page) => page.getByRole('complementary', { name: 'Decisions waiting for you' })

/** Opens the console, sets the speed (4x unless a test needs to see a short-lived state) and the
 * project's jitter through the UI, and starts the run. */
export async function startRun(page: Page, jitter: boolean, speed: '0.25x' | '4x' = '4x') {
  await page.goto('/')
  await page.getByRole('button', { name: speed }).click()
  if (jitter) await page.getByRole('checkbox', { name: 'Jitter' }).click()
  await page.getByRole('button', { name: 'Start run' }).click()
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
}

export async function approveDrafting(page: Page) {
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await card(page, 'drafting').getByRole('button', { name: 'Decision in the panel' }).click()
  await panel(page).getByRole('button', { name: 'Approve and send' }).click()
}

export async function answerScheduling(page: Page) {
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer')
  await card(page, 'scheduling').getByRole('button', { name: 'Decision in the panel' }).click()
  await panel(page).getByText('Week of 9 Mar', { exact: true }).click()
  await panel(page).getByRole('button', { name: 'Send answer' }).click()
}

export async function retryResearch(page: Page) {
  await expect(badge(page, 'research')).toHaveText('Failed')
  await card(page, 'research').getByRole('button', { name: 'Retry in the panel' }).click()
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click()
}
