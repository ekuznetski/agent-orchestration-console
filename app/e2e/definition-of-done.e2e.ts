import {
  answerScheduling,
  approveDrafting,
  badge,
  card,
  expect,
  layoutWatch,
  panel,
  retryResearch,
  startRun,
  test,
  watchLayout,
} from './fixtures.ts'

// The first six tests are the Definition of done items; the rest cover the partial result and its Retry, Cancel and
// Run again, layout stability every frame, long text and form controls. All run against the real app and the real
// mock (4x unless a test needs to see a short-lived state). Every wait is on UI state; there are no sleeps.

test('1. submitting a request renders exactly one status line per agent', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
  await expect(page.getByTestId('agent-status-line')).toHaveCount(3)
  // The debug controls are locked during the run and look it: the Jitter label (with its box) is dimmed.
  const jitterLabel = page.getByText('Jitter', { exact: true })
  await expect(jitterLabel).toHaveCSS('opacity', '0.5')
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
  // Before an irreversible action the whole draft is on screen: the body box does not clip it.
  const body = panel(page).getByText(/^Hi Maya,/)
  expect(await body.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
  // Not sent while waiting: let the other agents go on until they too wait for the user, then check again.
  await expect(badge(page, 'research')).toHaveText('Failed', { timeout: 60_000 })
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer', { timeout: 60_000 })
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await expect(drafting.getByTestId('agent-status-line')).not.toContainText('Sent')

  await panel(page).getByRole('button', { name: 'Edit email' }).click()
  // Save waits for a real change.
  await expect(panel(page).getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await panel(page).getByLabel('Subject').fill('Edited in the e2e test')
  // A double click on Save: the second click must not approve whatever opens under it.
  await panel(page).getByRole('button', { name: 'Save changes' }).dblclick()
  await expect(panel(page).getByRole('status')).toHaveText(
    'Draft a follow-up to Maya ChenEdit submittedThe agent is preparing the edited email...',
  )
  await expect(panel(page).getByRole('button', { name: 'Approve and send' })).toHaveCount(0)
  // The edited confirmation opens by itself: it answers the user's own Save.
  await expect(panel(page).getByText('Send the edited email?')).toBeVisible({ timeout: 15_000 })
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')

  await panel(page).getByRole('button', { name: 'Approve and send' }).click()
  await expect(badge(page, 'drafting')).toHaveText('Done', { timeout: 30_000 })
  await drafting.click()
  await expect(panel(page).getByText('Agent record')).toBeVisible()
  const approved = panel(page).getByText('You approved (revision 2)').locator('xpath=..')
  await expect(approved).toContainText('Edited in the e2e test')
  expect(await approved.getByText(/^Hi Maya,/).evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
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

test('a long free-text answer is clamped to two lines in the trace, with the full text in the tooltip', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer')
  await card(page, 'scheduling').getByRole('button', { name: 'Decision in the panel' }).click()
  const words = 'Any morning works, '.repeat(27).slice(0, 500)
  await panel(page).getByLabel('Or answer in your own words').fill(words)
  await panel(page).getByRole('button', { name: 'Send answer' }).click()
  const scheduling = card(page, 'scheduling')
  await scheduling.getByRole('button', { name: /Show steps/ }).click()
  const decided = scheduling.locator('li', { hasText: 'You chose:' }).locator('[title]')
  await expect(decided).toHaveAttribute('title', new RegExp(words.slice(-40)))
  // Two lines of 20px, whatever the length of the answer.
  expect((await decided.boundingBox())!.height).toBeLessThanOrEqual(40)
})

test('a 200-character agent label and a 500-character unbroken answer overflow nothing', async ({ page, jitter }) => {
  // The plan's label is text the console does not control: serve the mock with a 200-character Scheduling label.
  const label = 'L'.repeat(200)
  await page.route('**/mock/orchestrator.js*', async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace('Find time for a call next week', label)
    await route.fulfill({ response, body })
  })
  await startRun(page, jitter)
  const widths = () => page.getByTestId(/^agent-card-/).evaluateAll((cards) => cards.map((el) => el.getBoundingClientRect().width))
  const cardWidths = await widths()
  const noPageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

  // An outcome while Scheduling waits: the Next decision button carries the long label and stays in the footer.
  await expect(badge(page, 'scheduling')).toHaveText('Needs answer')
  await retryResearch(page)
  await approveDrafting(page)
  const next = panel(page).getByRole('button', { name: /^Next decision:/ })
  await expect(next).toBeVisible()
  const nextBox = (await next.boundingBox())!
  const panelBox = (await panel(page).boundingBox())!
  expect(nextBox.x).toBeGreaterThanOrEqual(panelBox.x)
  expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
  await expect(next.locator('[title]')).toHaveAttribute('title', label)

  // The answer is one unbroken 500-character string.
  await next.click()
  const words = 'w'.repeat(500)
  await panel(page).getByLabel('Or answer in your own words').fill(words)
  await panel(page).getByRole('button', { name: 'Send answer' }).click()
  await expect(panel(page).getByText(/^Answer sent:/)).toBeVisible()
  // The heading keeps the answer to two lines; the full text is in the record.
  expect(
    (await panel(page)
      .getByText(/^Answer sent:/)
      .boundingBox())!.height,
  ).toBeLessThanOrEqual(48)
  expect((await panel(page).boundingBox())!.width).toBe(panelBox.width)
  await card(page, 'scheduling')
    .getByRole('button', { name: /Show steps/ })
    .click()
  await expect(card(page, 'scheduling').locator('li', { hasText: 'You chose:' })).toBeVisible()
  await card(page, 'scheduling')
    .getByRole('button', { name: /Details in the panel|Decision in the panel/ })
    .click()
  await expect(panel(page).getByText(/^You answered:/)).toBeVisible()
  expect(await widths()).toEqual(cardWidths)
  expect((await panel(page).boundingBox())!.width).toBe(panelBox.width)
  expect(await noPageOverflow()).toBe(true)
})

test('a very long draft keeps Save reachable, and a long subject does not stretch the result', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await card(page, 'drafting').getByRole('button', { name: 'Decision in the panel' }).click()
  await panel(page).getByRole('button', { name: 'Edit email' }).click()
  // The editor caps the body at 320px with its own scroll, so Save stays on screen.
  await panel(page).getByLabel('Message').fill('Long body. '.repeat(3100))
  expect((await panel(page).getByLabel('Message').boundingBox())!.height).toBeLessThanOrEqual(320)
  await panel(page).getByLabel('Message').fill('Short body.')
  await panel(page).getByLabel('Subject').fill('Subject '.repeat(375))
  await panel(page).getByRole('button', { name: 'Save changes' }).click()
  await expect(panel(page).getByText('Send the edited email?')).toBeVisible()
  await panel(page).getByRole('button', { name: 'Approve and send' }).click()
  await retryResearch(page)
  await answerScheduling(page)
  const result = page.getByRole('region', { name: 'Result' })
  await expect(result.getByRole('heading', { name: 'Complete' })).toBeVisible()
  // The result item that echoes the subject is clamped to three lines.
  expect((await result.boundingBox())!.height).toBeLessThan(700)
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
  // Every agent ends Done; Scheduling's last step (seq 29) arrives after its done (seq 30) and takes its place in
  // the trace without flipping the agent back.
  await expect(page.getByTestId('agent-badge')).toHaveText(['Done', 'Done', 'Done'])
  const scheduling = card(page, 'scheduling')
  await scheduling.getByRole('button', { name: 'Show steps (4)' }).click()
  await expect(scheduling.locator('li')).toHaveText([/Your calendar/, /free\/busy/, /You chose: Week of 9 Mar/, /Placed a 30-min hold/])
  await expect(badge(page, 'scheduling')).toHaveText('Done')
  await scheduling.getByRole('button', { name: 'Hide steps' }).click()
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
  // The cards may move only when the newer result replaces this one; the block itself never goes away.
  await watchLayout(page)
  await result.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(result.getByText('Retrying...', { exact: true })).toBeVisible()
  await expect(result.getByRole('heading', { name: 'Updating' })).toBeVisible()
  await expect(result.getByRole('heading', { name: 'Complete' })).toBeVisible()
  await expect(result.getByText('All 3 agents finished. Updated after retry.')).toBeVisible()
  const watch = await layoutWatch(page)
  expect(watch.versions).toEqual([2])
  expect(watch.violations).toEqual([])
})

test('Cancel during a retry of a partial result keeps the partial result as it was', async ({ page, jitter }) => {
  await startRun(page, jitter)
  await expect(badge(page, 'research')).toHaveText('Failed')
  await approveDrafting(page)
  await answerScheduling(page)
  const result = page.getByRole('region', { name: 'Result' })
  await expect(result.getByRole('heading', { name: 'Partial result' })).toBeVisible()
  await result.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(result.getByText('Retrying...', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel run' }).click()
  await expect(result.getByRole('heading', { name: 'Run cancelled' })).toBeVisible()
  // The retried agent ends Cancelled, not waiting for an answer that will never come.
  await expect(badge(page, 'research')).toHaveText('Cancelled')
  await expect(result.getByText('This is the result from before the run was cancelled. 1 of 3 agents had failed.')).toBeVisible()
  await expect(result.getByText(/Retrying/)).toHaveCount(0)
})

test('Cancel run keeps the screen; Run again starts a fresh run', async ({ page, jitter }) => {
  await startRun(page, jitter)
  // The debug row items keep their place across running, cancelled and running again.
  const debugRow = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="Mock speed"] button, [role="checkbox"]'), ...document.querySelectorAll('button')]
        .filter((el) => el.getAttribute('role') === 'checkbox' || /x$|event log/i.test(el.textContent!.trim()))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return `${r.left},${r.top + window.scrollY}`
        }),
    )
  const running = await debugRow()
  await page.getByRole('button', { name: 'Cancel run' }).click()
  expect(await debugRow()).toEqual(running)
  await expect(page.getByTestId('run-summary')).toContainText('Run cancelled')
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
  await page.getByRole('button', { name: 'Run again' }).click()
  await expect(page.getByTestId('run-summary')).not.toContainText('Run cancelled')
  await expect(page.getByTestId(/^agent-card-/)).toHaveCount(3)
  await expect(page.getByTestId('agent-badge').filter({ hasText: 'Cancelled' })).toHaveCount(0)
  expect(await debugRow()).toEqual(running)
})

test('a double click on Run again starts one run and leaves it running', async ({ page, jitter }) => {
  await startRun(page, jitter, '0.25x')
  await page.getByRole('button', { name: 'Cancel run' }).click()
  await expect(page.getByTestId('run-summary')).toContainText('Run cancelled')
  await page.getByRole('button', { name: 'Run again' }).dblclick()
  await expect(page.getByTestId('run-summary')).toContainText('Running')
  await expect(page.getByTestId('run-summary')).not.toContainText('Run cancelled')
  await expect(page.getByRole('button', { name: 'Cancel run' })).toBeVisible()
})

test('the event log toggle keeps its place while events stream; the table does not widen', async ({ page, jitter }) => {
  await startRun(page, jitter)
  const toggle = page.getByRole('button', { name: /event log \(/i })
  await toggle.click()
  const toggleX = (await toggle.boundingBox())!.x
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await retryResearch(page)
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByRole('heading', { name: 'Complete' })).toBeVisible()
  expect((await toggle.boundingBox())!.x).toBe(toggleX)

  // A long payload wraps instead of widening the table, also in a narrow window.
  await page.setViewportSize({ width: 800, height: 900 })
  const widths = await page.locator('table').evaluate((table) => ({ table: table.scrollWidth, box: table.parentElement!.clientWidth }))
  expect(widths.table).toBeLessThanOrEqual(widths.box)
})

test('agent cards keep their position while decisions open and close', async ({ page, jitter }) => {
  await startRun(page, jitter)
  // Every frame: the cards may move only when the result block first appears.
  await watchLayout(page)
  await retryResearch(page)
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByRole('heading', { name: 'Complete' })).toBeVisible()
  const watch = await layoutWatch(page)
  expect(watch.cards).toHaveLength(3)
  expect(watch.versions).toEqual([1])
  expect(watch.violations).toEqual([])
})

test('with a trace open, only the cards below it move, and only while the trace grows under its cap', async ({ page, jitter }) => {
  await startRun(page, jitter)
  const research = card(page, 'research')
  await research.getByRole('button', { name: /Show steps/ }).click()
  await watchLayout(page, 'agent-card-agent_research')
  await retryResearch(page)
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByRole('heading', { name: 'Complete' })).toBeVisible()
  const watch = await layoutWatch(page)
  expect(watch.versions).toEqual([1])
  expect(watch.violations).toEqual([])
})

test("Drafting's open trace may grow and shrink (Working row, then the gate); only the cards below it move", async ({ page, jitter }) => {
  await startRun(page, jitter)
  await card(page, 'drafting')
    .getByRole('button', { name: /Show steps/ })
    .click()
  await watchLayout(page, 'agent-card-agent_drafting')
  await expect(badge(page, 'drafting')).toHaveText('Needs approval')
  await retryResearch(page)
  await approveDrafting(page)
  await answerScheduling(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByRole('heading', { name: 'Complete' })).toBeVisible()
  const watch = await layoutWatch(page)
  expect(watch.violations).toEqual([])
})

test('form controls keep the card surface when the system is in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const fill = (locator: ReturnType<typeof page.locator>) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
  // The text field has the card fill (#fafbfc), not the grey dark:bg-input/30.
  expect(await fill(page.getByRole('textbox', { name: 'Request' }))).toBe('rgb(250, 251, 252)')
  expect(await fill(page.getByRole('checkbox', { name: 'Jitter' }))).toBe('rgba(0, 0, 0, 0)')
})
