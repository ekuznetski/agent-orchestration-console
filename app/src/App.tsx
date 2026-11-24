import { AgentList } from '@/components/console/AgentCard'
import { DecisionPanel } from '@/components/console/DecisionPanel'
import { ResultBlock } from '@/components/console/ResultBlock'
import { StartCard, TopBar } from '@/components/console/TopBar'
import { useConsoleStore } from '@/store/console.store'
import { useViewStore } from '@/store/view.store'

/** Start card until the first run has its plan; then top bar, result, agents and the decision panel. */
export default function App() {
  const hasPlan = useConsoleStore((state) => state.plan !== null)
  const runKey = useConsoleStore((state) => state.startedAt)
  const runs = useViewStore((state) => state.runs)

  if (!hasPlan && runs <= 1) return <StartCard />

  return (
    <div className="flex h-dvh flex-col">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-[2fr_3fr]">
        <main className="flex flex-col gap-2.5 overflow-y-auto border-r p-3.5">
          <ResultBlock />
          <AgentList key={runKey ?? 'none'} />
        </main>
        <DecisionPanel />
      </div>
    </div>
  )
}
