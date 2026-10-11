import type { Estimate, Flag } from '../api/estimates';
import type { NewEntry } from '../data/repositories';
import { toDayKey } from './days';
import { isCalorieMismatch, isLargePortion } from './nutrition/plausibility';
import { sumMacros } from './nutrition/totals';
import { assertMacros, assertNonNegative } from './nutrition/validate';
import type { Macros, Quantity } from './types';

// Pure review-and-confirm state for an AI estimate (data-model.md, estimate lifecycle).

export interface ReviewItem {
  name: string;
  portion: Quantity;
  portionDescription: string;
  macros: Macros;
  flags: Flag[];
  /** Where the item came from: the AI, or added by hand during review. */
  origin: 'ai' | 'manual';
  /** True once the user changed any value of an AI item. */
  edited: boolean;
  /** True once the user explicitly accepted this item's warnings (constitution VI). */
  accepted: boolean;
}

export interface ReviewState {
  items: ReviewItem[];
}

export type ItemPatch = Partial<Pick<ReviewItem, 'name' | 'portion' | 'macros'>>;

export function startReview(estimate: Estimate): ReviewState {
  return {
    items: estimate.items.map((item) => ({
      ...item,
      flags: [...item.flags],
      origin: 'ai',
      edited: false,
      accepted: false,
    })),
  };
}

/** Applies an edit, re-checks the consistency flags, and requires fresh acceptance. */
export function editItem(state: ReviewState, index: number, patch: ItemPatch): ReviewState {
  const current = itemAt(state, index);
  const next = { ...current, ...patch };
  assertMacros(next.macros);
  assertNonNegative(next.portion.amount, 'portion amount');
  return replace(state, index, {
    ...next,
    flags: flagsFor(next.portion, next.macros),
    edited: true,
    accepted: false,
  });
}

export function removeItem(state: ReviewState, index: number): ReviewState {
  itemAt(state, index);
  return { items: state.items.filter((_, i) => i !== index) };
}

/** Adds an item the user entered by hand during review; it is logged with source 'manual'. */
export function addItem(state: ReviewState, item: Pick<ReviewItem, 'name' | 'portion' | 'macros'>): ReviewState {
  if (item.name.trim() === '') throw new RangeError('name is required');
  assertMacros(item.macros);
  assertNonNegative(item.portion.amount, 'portion amount');
  return {
    items: [
      ...state.items,
      {
        ...item,
        name: item.name.trim(),
        portionDescription: '',
        flags: flagsFor(item.portion, item.macros),
        origin: 'manual',
        edited: false,
        accepted: false,
      },
    ],
  };
}

export function acceptWarning(state: ReviewState, index: number): ReviewState {
  return replace(state, index, { ...itemAt(state, index), accepted: true });
}

export function needsAcceptance(item: ReviewItem): boolean {
  return item.flags.length > 0 && !item.accepted;
}

export function canConfirm(state: ReviewState): boolean {
  return state.items.length > 0 && !state.items.some(needsAcceptance);
}

export function reviewTotal(state: ReviewState): Macros {
  return sumMacros(state.items.map((i) => i.macros));
}

/** One entry per item. Each item is logged 1 ms after the previous one so lists keep the estimate order. */
export function toEntries(state: ReviewState, now: Date): NewEntry[] {
  return state.items.map((item, index) => ({
    name: item.name,
    quantity: item.portion,
    macros: item.macros,
    source: item.origin === 'manual' ? 'manual' : item.edited ? 'ai-edited' : 'ai',
    dayKey: toDayKey(now),
    loggedAt: new Date(now.getTime() + index).toISOString(),
    savedFoodId: null,
  }));
}

function flagsFor(portion: Quantity, macros: Macros): Flag[] {
  const flags: Flag[] = [];
  if (isCalorieMismatch(macros)) flags.push('calorie_macro_mismatch');
  if (isLargePortion(portion)) flags.push('large_portion');
  return flags;
}

function itemAt(state: ReviewState, index: number): ReviewItem {
  const item = state.items[index];
  if (!item) throw new RangeError(`no review item at index ${index}`);
  return item;
}

function replace(state: ReviewState, index: number, item: ReviewItem): ReviewState {
  return { items: state.items.map((existing, i) => (i === index ? item : existing)) };
}
