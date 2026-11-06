import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Services } from '../../src/app/services';
import { createChanges } from '../../src/data/changes';
import type { NewEntry } from '../../src/data/repositories';
import { EntryHistory } from '../../src/features/today/EntryHistory';
import { EntryEditor } from '../../src/features/today/EntryEditor';
import { RecentlyDeleted } from '../../src/features/today/RecentlyDeleted';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { DayLog } from '../../src/features/today/DayLog';
import { createTestServices, renderWithServices } from './testServices';

const now = new Date(2026, 10, 4, 12, 0);
const DAY = '2026-11-04';

const banana: NewEntry = {
  dayKey: DAY,
  loggedAt: now.toISOString(),
  name: 'Banana',
  quantity: { amount: 100, unit: 'g' },
  macros: { kcal: 100, proteinG: 10, carbsG: 20, fatG: 1 },
  source: 'manual',
  savedFoodId: null,
  mealCategory: 'lunch',
};

const amount = (grams: number) => ({ quantity: { amount: grams, unit: 'g' as const } });

async function setup(): Promise<Services> {
  return createTestServices({ changes: createChanges(), now: () => now });
}

describe('EntryHistory', () => {
  it('shows the current version, then earlier ones newest first, with how each changed', async () => {
    const services = await setup();
    const entry = await services.entries.create(banana);
    await services.entries.update(entry.id, amount(200));
    const current = await services.entries.update(entry.id, amount(300));

    await renderWithServices(<EntryHistory entry={current} onClose={() => undefined} onRestored={() => undefined} />, services);
    await screen.findAllByRole('button', { name: /restore/i });

    const items = within(screen.getByRole('list', { name: /versions/i })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/current/i);
    expect(items[0]).toHaveTextContent('300');
    expect(items[1]).toHaveTextContent('200');
    expect(items[1]).toHaveTextContent(/edited/i);
    expect(items[2]).toHaveTextContent('100');
  });

  it('restores an earlier version at once, with no confirmation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    const onRestored = vi.fn();
    const services = await setup();
    const entry = await services.entries.create(banana);
    const current = await services.entries.update(entry.id, amount(200));
    await renderWithServices(<EntryHistory entry={current} onClose={() => undefined} onRestored={onRestored} />, services);

    await user.click(await screen.findByRole('button', { name: /restore/i }));

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect((await services.entries.get(entry.id))!.quantity.amount).toBe(100);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('says when an entry has no earlier versions', async () => {
    const services = await setup();
    const entry = await services.entries.create(banana);

    await renderWithServices(<EntryHistory entry={entry} onClose={() => undefined} onRestored={() => undefined} />, services);

    expect(await screen.findByText(/no earlier versions/i)).toBeInTheDocument();
  });

  it('marks a version that was restored', async () => {
    const services = await setup();
    const entry = await services.entries.create(banana);
    const edited = await services.entries.update(entry.id, amount(200));
    const [earlier] = await services.entryVersions.listForEntry(edited);
    const restored = await services.entryVersions.restore(earlier!.id);

    await renderWithServices(<EntryHistory entry={restored} onClose={() => undefined} onRestored={() => undefined} />, services);
    await screen.findAllByRole('button', { name: /restore/i });

    const items = within(screen.getByRole('list', { name: /versions/i })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/restored/i);
    expect(items[1]).toHaveTextContent(/replaced by a restore/i);
  });

  it('refreshes when another device adds to it', async () => {
    const services = await setup();
    const entry = await services.entries.create(banana);
    await renderWithServices(<EntryHistory entry={entry} onClose={() => undefined} onRestored={() => undefined} />, services);
    await screen.findByText(/no earlier versions/i);

    await services.entries.update(entry.id, amount(200));
    await act(async () => services.changes.emit(new Set(['version'])));

    expect(await screen.findByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  it('opens from the editor and goes back', async () => {
    const user = userEvent.setup();
    const services = await setup();
    const entry = await services.entries.create(banana);
    await renderWithServices(<EntryEditor entry={entry} onClose={() => undefined} onChanged={() => undefined} />, services);

    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('list', { name: /versions/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to entry/i }));
    expect(screen.getByRole('textbox', { name: /food name/i })).toBeInTheDocument();
  });

  it('restores from the editor and tells the day to reload', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const services = await setup();
    const entry = await services.entries.create(banana);
    const current = await services.entries.update(entry.id, amount(200));
    await renderWithServices(<EntryEditor entry={current} onClose={() => undefined} onChanged={onChanged} />, services);

    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /restore/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe('RecentlyDeleted', () => {
  it('shows nothing when nothing was deleted', async () => {
    const services = await setup();

    const { container } = await renderWithServices(<RecentlyDeleted dayKey={DAY} refreshKey={0} onRestored={() => undefined} />, services);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lists a deleted entry behind a link, and restores it', async () => {
    const user = userEvent.setup();
    const onRestored = vi.fn();
    const services = await setup();
    const entry = await services.entries.create(banana);
    await services.entries.delete(entry.id);
    await renderWithServices(<RecentlyDeleted dayKey={DAY} refreshKey={0} onRestored={onRestored} />, services);

    await user.click(await screen.findByRole('button', { name: /recently deleted/i }));
    await user.click(await screen.findByRole('button', { name: /restore banana/i }));

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(await services.entries.get(entry.id)).toBeDefined();
  });

  it('appears on Today after a delete', async () => {
    const user = userEvent.setup();
    const services = await setup();
    await services.entries.create(banana);
    await renderWithServices(<TodayScreen onNavigate={() => undefined} />, services);

    await user.click(await screen.findByRole('button', { name: /banana/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: /yes, delete/i }));

    expect(await screen.findByRole('button', { name: /recently deleted/i })).toBeInTheDocument();
  });

  it('is on the history day view too', async () => {
    const services = await setup();
    const entry = await services.entries.create(banana);
    await services.entries.delete(entry.id);

    await renderWithServices(<DayLog dayKey={DAY} />, services);

    expect(await screen.findByRole('button', { name: /recently deleted/i })).toBeInTheDocument();
  });

  it('refreshes when another device deletes something', async () => {
    const services = await setup();
    const entry = await services.entries.create(banana);
    await renderWithServices(<DayLog dayKey={DAY} />, services);
    await screen.findByText(/banana/i);

    await services.entries.delete(entry.id);
    await act(async () => services.changes.emit(new Set(['entry', 'version'])));

    expect(await screen.findByRole('button', { name: /recently deleted/i })).toBeInTheDocument();
  });
});
