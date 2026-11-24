/// <reference lib="dom" />
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
export const panel = (page: Page) => page.getByRole('complementary', { name: /^(Decisions|Agent record)$/ })

/** Opens the console, sets the speed (4x unless a test needs to see a short-lived state) and the
 * project's jitter through the UI, and starts the run. */
export async function startRun(page: Page, jitter: boolean, speed: '0.25x' | '4x' = '4x') {
  await page.goto('/')
  // Web fonts swap in after load; measure layout only once they are in.
  await page.evaluate(() => document.fonts.ready)
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

type Watch = { cards: string[]; versions: number[]; violations: string[] }

/** Watches every frame from now on, in page coordinates (the page scrolls). The agent cards may move only in a frame where the result block appears
 * or is replaced by a newer result (its `data-version` changes); any other card move, and a result block that
 * goes away once shown, is a violation. */
/** Starts a per-frame watch of the agent cards. With `traceOf` (a card's test id whose trace the user opened),
 * cards below that card may move in a frame where its trace grew and was still under its 400px cap. */
export async function watchLayout(page: Page, traceOf?: string) {
  await page.evaluate((traceOf) => {
    const watch: Watch = { cards: [], versions: [], violations: [] }
    ;(window as unknown as { watch: Watch }).watch = watch
    let tops: number[] = []
    let ids: string[] = []
    let version: number | null = null
    let traceHeight: number | null = null
    const tick = () => {
      const block = document.querySelector<HTMLElement>('[aria-label="Result"]')
      const now = block ? Number(block.dataset.version) : 0
      const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="agent-card-"]')]
      const at = cards.map((el) => el.getBoundingClientRect().top + window.scrollY)
      const trace = traceOf ? document.querySelector<HTMLElement>(`[data-testid="${traceOf}"] [data-testid="agent-trace"]`) : null
      const height = trace ? trace.getBoundingClientRect().height : null
      watch.cards = cards.map((el) => el.dataset.testid!)
      if (version === null) {
        // first frame: the starting point
      } else if (now !== version) {
        if (now === 0) watch.violations.push(`result block removed after version ${version}`)
        else watch.versions.push(now)
      } else if (tops.length && at.some((top, i) => top !== tops[i])) {
        const grew = height !== null && traceHeight !== null && height > traceHeight && traceHeight < 400
        const below = cards.findIndex((el) => el.dataset.testid === traceOf)
        const allowed = grew && at.every((top, i) => top === tops[i] || i > below)
        if (!allowed) {
          const line = (list: number[]) => list.map((top, i) => `${ids[i]}@${top}`).join(' ')
          watch.violations.push(`cards moved: ${line(tops)} -> ${line(at)} (trace ${traceHeight} -> ${height})`)
        }
      }
      tops = at
      ids = watch.cards
      version = now
      traceHeight = height
      requestAnimationFrame(tick)
    }
    tick()
  }, traceOf)
}

/** What the watch saw, read after two more frames so the frame that shows the latest DOM change is counted. */
export const layoutWatch = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    return (window as unknown as { watch: Watch }).watch
  })
