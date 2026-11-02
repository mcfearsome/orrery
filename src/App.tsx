import { CosmologyPanel } from './sims/cosmology/ui'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">orrery</span>
        <span className="crumb">module 1 · background cosmology · black-hole leak vs ΛCDM</span>
        <span className="spacer" />
        <a className="link" href="https://github.com/mcfearsome/orrery" target="_blank" rel="noreferrer">github</a>
      </header>
      <CosmologyPanel />
    </div>
  )
}
