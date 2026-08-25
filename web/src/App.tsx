import { useEffect, useState } from 'react';
import {
  BarChart3,
  CreditCard,
  Cpu,
  Download,
  Layers,
  Network,
  Search,
  Zap,
} from 'lucide-react';
import { StoreProvider } from './store';
import { shutdownPool } from './core';
import { SingleCardView } from './views/SingleCardView';
import { BatchView } from './views/BatchView';
import { MpiView } from './views/MpiView';
import { GpuView } from './views/GpuView';
import { PerformanceView } from './views/PerformanceView';
import { ArchitectureView } from './views/ArchitectureView';
import { ExportView } from './views/ExportView';

/**
 * The notebook's main menu, as a single page. Options 1–7 map one-to-one;
 * option 8 was "Exit", which a web page does not need.
 */
const TABS = [
  { id: 'single', n: 1, label: 'Interactive', icon: Search, view: SingleCardView },
  { id: 'batch', n: 2, label: 'Batch Mode', icon: Layers, view: BatchView },
  { id: 'mpi', n: 3, label: 'MPI Demo', icon: Zap, view: MpiView },
  { id: 'gpu', n: 4, label: 'CUDA GPU', icon: Cpu, view: GpuView },
  { id: 'perf', n: 5, label: 'Performance', icon: BarChart3, view: PerformanceView },
  { id: 'arch', n: 6, label: 'Architecture', icon: Network, view: ArchitectureView },
  { id: 'export', n: 7, label: 'Export', icon: Download, view: ExportView },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [active, setActive] = useState<TabId>('single');

  // Release the worker pool when the page goes away.
  useEffect(() => shutdownPool, []);

  const ActiveView = TABS.find((t) => t.id === active)!.view;

  return (
    <StoreProvider>
      <div className="app">
        <header className="app__header">
          <div className="app__brand">
            <div className="logo">
              <CreditCard size={26} strokeWidth={1.75} aria-hidden />
            </div>
            <div className="app__titles">
              <h1>Credit Card Pattern Matching</h1>
              <p>
                Parallel &amp; Distributed Computing &middot; Syed Muhammad &middot; SP22-BCS-034
              </p>
            </div>
          </div>
        </header>

        <nav className="tabs" aria-label="Main menu">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`tab ${active === tab.id ? 'is-active' : ''}`}
                onClick={() => setActive(tab.id)}
                aria-current={active === tab.id ? 'page' : undefined}
              >
                <Icon size={17} strokeWidth={2} aria-hidden />
                <span className="tab__n">{tab.n}</span>
                <span className="tab__label">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="app__main">
          <ActiveView />
        </main>

        <footer className="app__footer">
          Everything runs in your browser — no card number is sent anywhere. Ported from{' '}
          <code>PDC_Project.ipynb</code>, which stays in the repository unchanged.
        </footer>
      </div>
    </StoreProvider>
  );
}
