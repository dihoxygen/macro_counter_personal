import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFood } from '../../src/features/add-food/AddFood';
import { toDayKey } from '../../src/domain/days';
import { renderWithServices } from './testServices';

describe('AddFood when AI is blocked', () => {
  it('offline: offers only manual entry, says why, and does not call the server', async () => {
    const user = userEvent.setup();
    const getStatus = vi.fn(async () => ({ aiAvailable: true }));
    const onDone = vi.fn();
    const { services } = await renderWithServices(<AddFood onDone={onDone} />, {
      aiBlockedReason: 'offline',
      getStatus,
    });

    expect(
      screen.getByText(
        'Sign in or reconnect to use AI lookup. You can still enter the food manually.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /entry method/i })).toBeNull();
    expect(getStatus).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/food name/i), 'Boiled egg');
    await user.type(screen.getByLabelText(/amount/i), '50');
    await user.type(screen.getByLabelText(/calories/i), '78');
    await user.type(screen.getByLabelText(/protein/i), '6.3');
    await user.type(screen.getByLabelText(/carbs/i), '0.6');
    await user.type(screen.getByLabelText(/fat/i), '5.3');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await services.entries.listByDay(toDayKey(new Date()))).map((e) => e.name)).toEqual([
      'Boiled egg',
    ]);
  });

  it('online: unchanged, with the entry methods and a status check', async () => {
    const getStatus = vi.fn(async () => ({ aiAvailable: true }));
    await renderWithServices(<AddFood onDone={vi.fn()} />, { getStatus });

    expect(await screen.findByRole('group', { name: /entry method/i })).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalled();
  });
});
