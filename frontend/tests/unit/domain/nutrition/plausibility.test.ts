import { describe, expect, it } from 'vitest';
import { isCalorieMismatch, isImplausiblyLarge } from '../../../../src/domain/nutrition/plausibility';
import type { Macros, Quantity } from '../../../../src/domain/types';

const ok: Macros = { kcal: 200, proteinG: 20, carbsG: 20, fatG: 5 };
const g = (amount: number): Quantity => ({ amount, unit: 'g' });

describe('isImplausiblyLarge (research R5 limits)', () => {
  it('is false for an ordinary food', () => {
    expect(isImplausiblyLarge(g(150), ok)).toBe(false);
  });

  it('is false exactly at each limit', () => {
    expect(isImplausiblyLarge(g(2000), ok)).toBe(false);
    expect(isImplausiblyLarge({ amount: 2000, unit: 'ml' }, ok)).toBe(false);
    expect(isImplausiblyLarge(g(100), { ...ok, kcal: 5000 })).toBe(false);
    expect(isImplausiblyLarge(g(100), { ...ok, proteinG: 1000 })).toBe(false);
    expect(isImplausiblyLarge(g(100), { ...ok, carbsG: 1000 })).toBe(false);
    expect(isImplausiblyLarge(g(100), { ...ok, fatG: 1000 })).toBe(false);
  });

  it('is true just above each limit', () => {
    expect(isImplausiblyLarge(g(2000.1), ok)).toBe(true);
    expect(isImplausiblyLarge({ amount: 2000.1, unit: 'ml' }, ok)).toBe(true);
    expect(isImplausiblyLarge(g(100), { ...ok, kcal: 5000.1 })).toBe(true);
    expect(isImplausiblyLarge(g(100), { ...ok, proteinG: 1000.1 })).toBe(true);
    expect(isImplausiblyLarge(g(100), { ...ok, carbsG: 1000.1 })).toBe(true);
    expect(isImplausiblyLarge(g(100), { ...ok, fatG: 1000.1 })).toBe(true);
  });

  it('does not apply the 2000 limit to servings', () => {
    expect(isImplausiblyLarge({ amount: 2500, unit: 'serving' }, ok)).toBe(false);
  });
});

// Mirrors the backend MacroMath rule so the review screen can re-check edited values.
describe('isCalorieMismatch (4/4/9 within max(20 kcal, 15%))', () => {
  const m = (kcal: number, proteinG: number, carbsG: number, fatG: number): Macros => ({
    kcal,
    proteinG,
    carbsG,
    fatG,
  });

  // Expected 170 kcal; tolerance 25.5.
  it.each([
    [170, false],
    [195.5, false],
    [144.5, false],
    [195.6, true],
    [144.4, true],
  ])('kcal %s for 10/10/10 g → %s', (kcal, expected) => {
    expect(isCalorieMismatch(m(kcal, 10, 10, 10))).toBe(expected);
  });

  // Expected 20 kcal; the 20 kcal floor applies.
  it.each([
    [40, false],
    [0, false],
    [40.1, true],
  ])('kcal %s for 5 g protein → %s', (kcal, expected) => {
    expect(isCalorieMismatch(m(kcal, 5, 0, 0))).toBe(expected);
  });

  it('is false for all zeros', () => {
    expect(isCalorieMismatch(m(0, 0, 0, 0))).toBe(false);
  });

  it('throws RangeError for invalid values', () => {
    expect(() => isCalorieMismatch(m(-1, 0, 0, 0))).toThrow(RangeError);
    expect(() => isCalorieMismatch(m(10, Number.NaN, 0, 0))).toThrow(RangeError);
  });
});
