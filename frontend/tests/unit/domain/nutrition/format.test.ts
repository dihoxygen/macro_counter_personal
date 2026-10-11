import { describe, expect, it } from 'vitest';
import { formatGrams, formatGramsOfGoal, formatKcal } from '../../../../src/domain/nutrition/format';

describe('formatKcal', () => {
  it.each([
    [0, '0 kcal'],
    [183, '183 kcal'],
    [182.5, '183 kcal'],
    [182.49, '182 kcal'],
    [99999.4, '99999 kcal'],
    [99999.94, '100000 kcal'],
    [99999.5, '100000 kcal'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatKcal(value)).toBe(expected);
  });
});

describe('formatGrams', () => {
  it.each([
    [0, '0 g'],
    [90, '90 g'],
    [9.94, '9.9 g'],
    [9.95, '10 g'],
    [0.05, '0.1 g'],
    [0.04, '0 g'],
    [12.6, '12.6 g'],
    [10.3, '10.3 g'],
    [99999.94, '99999.9 g'],
    [99999.96, '100000 g'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatGrams(value)).toBe(expected);
  });

  it('rounds halves up', () => {
    expect(formatGrams(1.25)).toBe('1.3 g');
    expect(formatGrams(0.15)).toBe('0.2 g');
  });
});

describe('formatGramsOfGoal', () => {
  it.each([
    [90, 150, '90 / 150 g'],
    [9.94, 150, '9.9 / 150 g'],
    [0, 120.5, '0 / 120.5 g'],
  ])('formats %s of %s as %s', (logged, goal, expected) => {
    expect(formatGramsOfGoal(logged, goal)).toBe(expected);
  });
});
