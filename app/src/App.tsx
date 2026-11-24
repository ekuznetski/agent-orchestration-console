import { AgentList } from '@/components/console/AgentCard'
import { DecisionPanel } from '@/components/console/DecisionPanel'
import { ResultBlock } from '@/components/console/ResultBlock'
import { Brand, StartCard, TopBar } from '@/components/console/TopBar'
import { useConsoleStore } from '@/store/console.store'
import { useViewStore } from '@/store/view.store'

/** Start card until the first run has its plan; then top bar, result, agents and the decision panel. */
export default function App() {
  const hasPlan = useConsoleStore((state) => state.plan !== null)
  const runKey = useConsoleStore((state) => state.startedAt)
  const runs = useViewStore((state) => state.runs)

  if (!hasPlan && runs <= 1) return <StartCard />

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-6 pb-12">
      <Brand />
      <TopBar />
      {/* Full width above both columns: the result is what the user looks for when the run ends. */}
      <div className="mt-6 empty:hidden">
        <ResultBlock />
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-6">
        <main className="flex flex-col gap-6">
          <AgentList key={runKey ?? 'none'} />
        </main>
        {/* Sticky beside the agents; a panel taller than the window scrolls on its own. */}
        <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg">
          <DecisionPanel />
        </div>
      </div>
    </div>
  )
}
