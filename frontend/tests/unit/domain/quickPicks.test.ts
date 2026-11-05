import { describe, expect, it } from 'vitest';
import { QUICK_PICK_WINDOW_DAYS, rankQuickPicks } from '../../../src/domain/quickPicks';

const TODAY = '2026-11-30';

const food = (id: string, lastUsedAt = '2026-01-01T00:00:00.000Z') => ({ id, lastUsedAt });
const use = (savedFoodId: string | null, dayKey = '2026-11-20', loggedAt = `${dayKey}T08:00:00.000Z`) => ({ savedFoodId, dayKey, loggedAt });

const order = (foods: ReturnType<typeof food>[], entries: ReturnType<typeof use>[]) =>
  rankQuickPicks(foods, entries, TODAY).map((f) => f.id);

describe('rankQuickPicks', () => {
  it('puts the most used foods first', () => {
    expect(order([food('y'), food('x')], [use('x'), use('x'), use('x'), use('y')])).toEqual(['x', 'y']);
  });

  it('breaks a tie with the latest use', () => {
    expect(order([food('a'), food('b')], [use('a', '2026-11-20'), use('b', '2026-11-21')])).toEqual(['b', 'a']);
  });

  it('puts foods unused in the window after the rest, by last use', () => {
    const foods = [food('old', '2026-02-01T00:00:00.000Z'), food('older', '2026-01-01T00:00:00.000Z'), food('used', '2026-01-01T00:00:00.000Z')];

    expect(order(foods, [use('used')])).toEqual(['used', 'old', 'older']);
  });

  it('counts today and the 29 days before it, and nothing older', () => {
    expect(QUICK_PICK_WINDOW_DAYS).toBe(30);
    const foods = [food('edge'), food('out')];

    expect(order(foods, [use('edge', '2026-11-01')])).toEqual(['edge', 'out']);
    expect(order(foods, [use('out', '2026-10-31'), use('edge', '2026-11-01')])).toEqual(['edge', 'out']);
  });

  it('ignores entries with no link, or a link to a food that is not here', () => {
    expect(order([food('a')], [use(null), use('gone')])).toEqual(['a']);
  });

  it('settles every remaining tie by id, so all devices agree', () => {
    const foods = [food('b'), food('c'), food('a')];

    expect(order(foods, [])).toEqual(['a', 'b', 'c']);
    expect(order([food('b'), food('a')], [use('b'), use('a')])).toEqual(['a', 'b']);
  });

  it('does not change the list it was given', () => {
    const foods = [food('b'), food('a')];

    rankQuickPicks(foods, [], TODAY);

    expect(foods.map((f) => f.id)).toEqual(['b', 'a']);
  });
});
