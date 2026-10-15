import { useState } from 'react';
import { AccountMenu } from './auth/AccountMenu';
import { AddFood } from './features/add-food/AddFood';
import { GoalSettings } from './features/goal/GoalSettings';
import { DayView } from './features/history/DayView';
import { RecentFoods } from './features/recent/RecentFoods';
import { TodayScreen } from './features/today/TodayScreen';

export type View = 'today' | 'add' | 'recent' | 'history' | 'goal' | 'account';

const titles: Record<Exclude<View, 'today'>, string> = {
  add: 'Add food',
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
      {view === 'today' ? (
        <TodayScreen onNavigate={setView} />
      ) : (
        <section>
          <ScreenHeader title={titles[view]} onBack={goToday} />
          {view === 'add' && <AddFood onDone={goToday} />}
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
