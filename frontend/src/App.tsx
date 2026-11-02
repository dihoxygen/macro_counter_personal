import { useState } from 'react';
import { AccountMenu } from './auth/AccountMenu';
import { GoalSettings } from './features/goal/GoalSettings';
import { DayView } from './features/history/DayView';
import { RecentFoods } from './features/recent/RecentFoods';
import { TodayScreen } from './features/today/TodayScreen';

export type View = 'today' | 'recent' | 'history' | 'goal' | 'account';

const titles: Record<Exclude<View, 'today'>, string> = {
  recent: 'Recent foods',
  history: 'Previous days',
  goal: 'Protein goal',
  account: 'Account',
};

// Plain state-based view switching; no router library (Principle V).
export default function App() {
  const [view, setView] = useState<View>('today');
  const goToday = () => setView('today');

  return (
    <main className="app">
      {/* Today stays mounted while another view shows, so an open estimate and drafts survive (FR-006). */}
      <div hidden={view !== 'today'}>
        <TodayScreen active={view === 'today'} onNavigate={setView} />
      </div>
      {view !== 'today' && (
        <section>
          <ScreenHeader title={titles[view]} onBack={goToday} />
          {view === 'history' && <DayView />}
          {view === 'recent' && <RecentFoods onLogged={goToday} />}
          {view === 'goal' && <GoalSettings onSaved={goToday} />}
          {view === 'account' && <AccountMenu />}
        </section>
      )}
    </main>
  );
}

export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="screen-header">
      <button type="button" onClick={onBack}>
        ← Back
      </button>
      <h1>{title}</h1>
    </header>
  );
}
