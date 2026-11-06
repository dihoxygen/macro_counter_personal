import { describe, expect, it } from 'vitest';
import { categoryForTime } from '../../../src/domain/meals';

const at = (hour: number, minute = 0) => new Date(2026, 10, 4, hour, minute);

describe('categoryForTime', () => {
  it.each([
    [4, 0, 'breakfast'],
    [8, 30, 'breakfast'],
    [10, 59, 'breakfast'],
    [11, 0, 'lunch'],
    [14, 59, 'lunch'],
    [15, 0, 'snacks'],
    [16, 59, 'snacks'],
    [17, 0, 'dinner'],
    [21, 59, 'dinner'],
    [22, 0, 'snacks'],
    [0, 0, 'snacks'],
    [3, 59, 'snacks'],
  ] as const)('at %i:%i is %s', (hour, minute, category) => {
    expect(categoryForTime(at(hour, minute))).toBe(category);
  });
});
