import { Shell } from './ui/Shell'
import { useStore } from './ui/store'
import { AccuracyView } from './views/AccuracyView'
import { BoardView } from './views/BoardView'
import { CroView } from './views/CroView'
import { MethodologyView } from './views/MethodologyView'
import { RepView } from './views/RepView'
import { TeamView } from './views/TeamView'

export default function App() {
  const role = useStore((s) => s.role)
  const page = useStore((s) => s.page)
  return (
    <Shell>
      {page === 'accuracy' ? <AccuracyView />
        : page === 'methodology' ? <MethodologyView />
        : role === 'rep' ? <RepView />
        : role === 'manager' ? <TeamView role="manager" />
        : role === 'director' ? <TeamView role="director" />
        : role === 'cro' ? <CroView />
        : <BoardView />}
    </Shell>
  )
}
