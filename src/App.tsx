import { useEffect, useState } from 'react'
import { CosmologyPanel } from './sims/cosmology/ui'
import { OneSheetPanel } from './sims/one-sheet/ui'

const MODULES = {
  cosmology: { label: 'module 1 · cosmology', crumb: 'background cosmology · black-hole leak vs ΛCDM', Panel: CosmologyPanel },
  'one-sheet': { label: 'module 2 · one sheet', crumb: 'one sheet, two sides · topside well, underside hill', Panel: OneSheetPanel },
} as const
type ModuleId = keyof typeof MODULES

const fromHash = (): ModuleId => {
  const h = location.hash.slice(1)
  return h in MODULES ? (h as ModuleId) : 'cosmology'
}

export default function App() {
  const [mod, setMod] = useState<ModuleId>(fromHash)
  useEffect(() => {
    const on = () => setMod(fromHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const { crumb, Panel } = MODULES[mod]
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">orrery</span>
        <nav className="tabs">
          {(Object.keys(MODULES) as ModuleId[]).map((id) => (
            <a key={id} className={`tab${id === mod ? ' active' : ''}`} href={`#${id}`}>{MODULES[id].label}</a>
          ))}
        </nav>
        <span className="crumb">{crumb}</span>
        <span className="spacer" />
        <a className="link" href="https://github.com/mcfearsome/orrery" target="_blank" rel="noreferrer">github</a>
      </header>
      <Panel />
    </div>
  )
}
