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

/** Watches every frame from now on, in page coordinates (the page scrolls).
 * - The agent cards and the panel may move only in a frame where the result block appears or is replaced (its
 *   `data-version` changes); a result block that goes away once shown is a violation.
 * - With `traceOf` (a card's test id whose trace the user opened), cards below that card may also move in a frame
 *   where its trace grew or shrank (new steps, the Working row coming or going; the trace is capped at 400px).
 * - The panel's height and its footer's top may change only within 600ms of the user's own input, when the result
 *   moves the panel, or when a decision opens in the empty panel. */
export async function watchLayout(page: Page, traceOf?: string) {
  await page.evaluate((traceOf) => {
    const watch: Watch = { cards: [], versions: [], violations: [] }
    ;(window as unknown as { watch: Watch }).watch = watch
    let tops: number[] = []
    let ids: string[] = []
    let version: number | null = null
    let traceHeight: number | null = null
    let panelBox: string | null = null
    let wasEmpty = false
    let lastInput = -Infinity
    let scroll = ''
    const input = () => (lastInput = performance.now())
    document.addEventListener('pointerdown', input, true)
    document.addEventListener('keydown', input, true)
    const tick = () => {
      const block = document.querySelector<HTMLElement>('[aria-label="Result"]')
      const now = block ? Number(block.dataset.version) : 0
      const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="agent-card-"]')]
      // The panel is watched with the cards: the full-width result moves both, and nothing else may.
      const panel = document.querySelector<HTMLElement>('aside')
      // Cards in page coordinates; the sticky panel in viewport coordinates (where the user sees it), compared only
      // in frames without a scroll.
      const at = [
        ...cards.map((el) => el.getBoundingClientRect().top + window.scrollY),
        ...(panel ? [panel.getBoundingClientRect().top] : []),
      ]
      const trace = traceOf ? document.querySelector<HTMLElement>(`[data-testid="${traceOf}"] [data-testid="agent-trace"]`) : null
      const height = trace ? trace.getBoundingClientRect().height : null
      // The page and the panel's own scroll box (a panel taller than the window scrolls on its own).
      const scrollNow = `${window.scrollY} ${panel?.parentElement?.scrollTop ?? 0}`
      const footer = panel?.querySelector<HTMLElement>('[data-testid="panel-footer"]')
      const box = panel
        ? `h=${panel.getBoundingClientRect().height} footer=${footer ? footer.getBoundingClientRect().top - panel.getBoundingClientRect().top : 'none'}`
        : null
      const empty = panel?.textContent?.includes('Nothing needs you right now') ?? false
      watch.cards = cards.map((el) => el.dataset.testid!)
      const labels = [...watch.cards, ...(panel ? ['panel'] : [])]
      const byUser = performance.now() - lastInput < 600
      if (version === null) {
        // first frame: the starting point
      } else if (now !== version) {
        if (now === 0) watch.violations.push(`result block removed after version ${version}`)
        else watch.versions.push(now)
      } else {
        // A scroll of the page or of the panel's box (the user, or focus moving into view after a click) moves the
        // panel in the viewport.
        const scrolled = scrollNow !== scroll
        const panelIndex = panel ? at.length - 1 : -1
        const moved = (top: number, i: number) => top !== tops[i] && !(scrolled && i === panelIndex)
        if (tops.length && at.some(moved)) {
          const changed = height !== null && traceHeight !== null && height !== traceHeight
          const below = cards.findIndex((el) => el.dataset.testid === traceOf)
          // The panel (last entry) never moves with a trace: only cards below the traced one do.
          const allowed = changed && at.every((top, i) => !moved(top, i) || (i > below && i < cards.length))
          if (!allowed) {
            const line = (list: number[]) => list.map((top, i) => `${ids[i]}@${top}`).join(' ')
            watch.violations.push(`cards moved: ${line(tops)} -> ${line(at)} (trace ${traceHeight} -> ${height})`)
          }
        }
        if (panelBox !== null && box !== panelBox && !byUser && !wasEmpty)
          watch.violations.push(`panel resized or its footer moved without the user: ${panelBox} -> ${box}`)
      }
      tops = at
      ids = labels
      version = now
      traceHeight = height
      panelBox = box
      scroll = scrollNow
      wasEmpty = empty
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
