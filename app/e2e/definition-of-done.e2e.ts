/// <reference lib="dom" />
import { answerScheduling, approveDrafting, badge, card, expect, panel, retryResearch, startRun, test } from './fixtures.ts'

// Each test is one item of the task's Definition of done, against the real app and the real mock at 4x.
// Every wait is on UI state; there are no sleeps.

test('1. submitting a request renders exactly one status line per agent', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
  await expect(page.getByTestId('agent-status-line')).toHaveCount(3)
})

test('2. a line updates in place: same element, no duplicates', async ({ page, jitter }) => {
  await startRun(page, jitter)
  const held = await card(page, 'research').elementHandle()
  const seen = new Set<string>()
  await expect
    .poll(async () => {
      seen.add(await held!.evaluate((el) => el.querySelector('[data-testid="agent-status-line"]')!.textContent ?? ''))
      return seen.size
    })
    .toBeGreaterThanOrEqual(3)
  expect(await card(page, 'research').evaluate((el, h) => el === h, held)).toBe(true)
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
})

test('3. an expanded line shows its ordered trace; an agent without steps shows the empty state', async ({ page, jitter }) => {
  // 0.25x, so Scheduling has no steps yet when it is expanded right after the plan.
  test.setTimeout(90_000)
  await startRun(page, jitter, '0.25x')
  const scheduling = card(page, 'scheduling')
  await scheduling.getByRole('button', { name: 'Show steps (0)' }).click()
  await expect(scheduling.getByText('No steps yet. Steps appear here as the agent reports them.', { exact: true })).toBeVisible()

  await expect(badge(page, 'research')).toHaveText('Failed', { timeout: 60_000 })
  const research = card(page, 'research')
  await research.getByRole('button', { name: 'Show steps (4)' }).click()
  await expect(research.locator('b').filter({ hasText: /^(Searched|Read|Decided):$/ })).toHaveText([
    'Searched:',
    'Searched:',
    'Read:',
    'Read:',
  ])
  await expect(research.getByText("Jira NW-2291 'Renewal blockers' \u2014 3 open issues")).toBeVisible()
})

test('4. a confirmation does not fire until approved; Edit forces a fresh approval', async ({ page, jitter }) => {
  // 0.25x, so the wait between Save and the re-asked confirmation is on screen long enough to assert.
  test.setTimeout(120_000)
  await startRun(page, jitter, '0.25x')
  const drafting = card(page, 'drafting')
  await expect(badge(page, 'drafting')).toHaveText('Needs approval', { timeout: 60_000 })
  await drafting.getByRole('button', { name: 'Decision in the panel' }).click()
  await expect(panel(page).getByText('Send this email?')).toBeVisible()
  // Not sent while waiting: let the other agents go on until they too wait for the user, then check again.
  await expect(badge(page, 'research')).toHaveText('Failed', { timeout: 60_000 })
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer', { timeout: 60_000 })
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await expect(drafting.getByTestId('agent-status-line')).not.toContainText('Sent')

  await panel(page).getByRole('button', { name: 'Edit email' }).click()
  await panel(page).getByLabel('Subject').fill('Edited in the e2e test')
  await panel(page).getByRole('button', { name: 'Save changes' }).click()
  await expect(panel(page).getByRole('status')).toHaveText('Edited version sentWaiting for the agent to respond.')
  await expect(panel(page).getByRole('button', { name: 'Approve and send' })).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Next decision: Drafting' }).click({ timeout: 15_000 })
  await expect(panel(page).getByText('Send the edited email?')).toBeVisible()
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')

  await panel(page).getByRole('button', { name: 'Approve and send' }).click()
  await expect(badge(page, 'drafting')).toHaveText('Done', { timeout: 30_000 })
  await drafting.click()
  await expect(panel(page).getByText('Agent record')).toBeVisible()
  const approved = panel(page).getByText('You approved (revision 2)').locator('xpath=..')
  await expect(approved).toContainText('Edited in the e2e test')
})

test('5. an escalation pauses only its own agent; an answer resumes it', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer')
  await retryResearch(page)
  await approveDrafting(page)
  await expect(badge(page, 'research')).toHaveText('Done')
  await expect(badge(page, 'drafting')).toHaveText('Done')
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer')
  await answerScheduling(page)
  await expect(badge(page, 'scheduling')).toHaveText('Done')
})

test('6. a failed agent shows its error and a retry; the result is separate and reads Complete', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(badge(page, 'research')).toHaveText('Failed')
  await card(page, 'research').getByRole('button', { name: 'Retry in the panel' }).click()
  await expect(panel(page).getByText('Retry this agent?')).toBeVisible()
  await expect(panel(page).getByText('jira.search timed out after 30s')).toBeVisible()
  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(panel(page).getByText('Retry sent: attempt 2')).toBeVisible()
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(badge(page, 'research')).toHaveText('Done')

  const result = page.getByRole('region', { name: 'Result' })
  await expect(result.getByRole('heading', { name: 'Complete' })).toBeVisible()
  const resultBox = await result.boundingBox()
  const firstCard = await card(page, 'research').boundingBox()
  expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(firstCard!.y)
})

test('a partial result is retried from its error item and becomes Complete', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(badge(page, 'research')).toHaveText('Failed')
  await approveDrafting(page)
  await answerScheduling(page)
  const result = page.getByRole('region', { name: 'Result' })
  await expect(result.getByRole('heading', { name: 'Partial result' })).toBeVisible()
  const before = await card(page, 'research').boundingBox()
  await result.getByRole('button', { name: 'Retry agent' }).click()
  await expect(result.getByText('Retrying...', { exact: true })).toBeVisible()
  expect(await card(page, 'research').boundingBox()).toEqual(before)
  await expect(result.getByRole('heading', { name: 'Updating' })).toBeVisible()
  expect(await card(page, 'research').boundingBox()).toEqual(before)
  await expect(result.getByRole('heading', { name: 'Complete' })).toBeVisible()
})

test('Cancel run keeps the screen; Run again starts a fresh run', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await page.getByRole('button', { name: 'Cancel run' }).click()
  await expect(page.getByTestId('run-summary')).toContainText('Run cancelled')
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
  await page.getByRole('button', { name: 'Run again' }).click()
  await expect(page.getByTestId('run-summary')).not.toContainText('Run cancelled')
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
  await expect(page.getByTestId('agent-badge').filter({ hasText: 'Cancelled' })).toHaveCount(0)
})

test('the open event log keeps its height and its toggle its place while events stream', async ({ page, jitter }) => {
  await startRun(page, jitter)
  const toggle = page.getByRole('button', { name: /^Event log/ })
  await toggle.click()
  const log = page.getByText('Arrival order.', { exact: false }).locator('xpath=..').locator('xpath=..')
  const first = await log.boundingBox()
  const toggleX = (await toggle.boundingBox())!.x
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await retryResearch(page)
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByRole('heading', { name: 'Complete' })).toBeVisible()
  expect(await log.boundingBox()).toEqual(first)
  expect((await toggle.boundingBox())!.x).toBe(toggleX)
})

test('agent cards keep their position while decisions open and close', async ({ page, jitter }) => {
  await startRun(page, jitter)
  // Every frame until the result arrives (the one allowed shift), record any card that moved.
  await page.evaluate(() => {
    const seen: Record<string, string> = {}
    const moves: string[] = []
    ;(window as unknown as { moves: string[]; seen: object }).moves = moves
    ;(window as unknown as { moves: string[]; seen: object }).seen = seen
    const tick = () => {
      if (document.querySelector('[aria-label="Result"]')) return
      document.querySelectorAll<HTMLElement>('[data-testid^="agent-card-"]').forEach((el) => {
        const box = el.getBoundingClientRect()
        const at = `${box.top},${box.height}`
        const id = el.dataset.testid!
        if (!(id in seen)) seen[id] = at
        else if (seen[id] !== at) moves.push(`${id}: ${seen[id]} -> ${at}`)
      })
      requestAnimationFrame(tick)
    }
    tick()
  })
  await retryResearch(page)
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(page.getByRole('region', { name: 'Result' })).toBeVisible()
  const watched = await page.evaluate(() => {
    const { moves, seen } = window as unknown as { moves: string[]; seen: object }
    return { moves, seen }
  })
  expect(Object.keys(watched.seen)).toHaveLength(3)
  expect(watched.moves).toEqual([])
})
