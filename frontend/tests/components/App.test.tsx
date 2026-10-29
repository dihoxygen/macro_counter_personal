import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import { toDayKey } from '../../src/domain/days';
import type { NewEntry } from '../../src/data/repositories';
import { createTestServices, renderWithServices } from './testServices';

const entry = (name: string): NewEntry => ({
  dayKey: toDayKey(new Date()),
  loggedAt: new Date().toISOString(),
  name,
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: 100, proteinG: 10, carbsG: 10, fatG: 1 },
  source: 'manual',
  savedFoodId: null,
});

describe('App shell', () => {
  it('renders the Today view by default', async () => {
    await renderWithServices(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /today/i })).toBeInTheDocument();
  });

  it('switches views through state and comes back to Today', async () => {
    const user = userEvent.setup();
    await renderWithServices(<App />);

    await user.click(await screen.findByRole('button', { name: /add food/i }));
    expect(await screen.findByRole('heading', { level: 1, name: /add food/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByRole('heading', { level: 1, name: /today/i })).toBeInTheDocument();
  });

  it('opens the Account view with sign-out options', async () => {
    const user = userEvent.setup();
    await renderWithServices(<App />);

    await user.click(await screen.findByRole('button', { name: /^account$/i }));

    expect(await screen.findByRole('heading', { level: 1, name: /account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign out$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out everywhere/i })).toBeInTheDocument();
  });

  // Feature 004: Today stays mounted (hidden) while another view shows, so its state survives (FR-006).
  it('keeps Today mounted while another view shows, so an open editor survives the visit', async () => {
    const user = userEvent.setup();
    const services = await createTestServices();
    await services.entries.create(entry('Greek yogurt'));
    await renderWithServices(<App />, services);

    await user.click(await screen.findByRole('button', { name: /greek yogurt/i }));
    expect(screen.getByRole('form', { name: 'Edit Greek yogurt' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous days' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Today', hidden: true })).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Edit Greek yogurt' })).toBeInTheDocument();
  });

  it('refreshes Today when it becomes visible again', async () => {
    const user = userEvent.setup();
    const services = await createTestServices();
    await renderWithServices(<App />, services);
    await screen.findByText(/nothing logged yet/i);

    await user.click(screen.getByRole('button', { name: 'Previous days' }));
    await services.entries.create(entry('Logged while away'));
    await user.click(screen.getByRole('button', { name: /back/i }));

    const list = await screen.findByRole('list', { name: /entries/i });
    expect(within(list).getByText('Logged while away')).toBeInTheDocument();
  });
});
