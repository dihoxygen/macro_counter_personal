import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App';
import { renderWithServices } from './testServices';

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
});
