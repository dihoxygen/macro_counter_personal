import { describe, expect, it } from 'vitest';

// 004 FR-001: user-facing text calls the owner's one-time code an "invite code", never a "temporary code".

const sources = import.meta.glob<string>('../../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** String literals and JSX text, with comments stripped (they are for developers, not users). */
function userFacingText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('wording', () => {
  it('no user-facing text says "temporary code"', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(10);

    const offenders = files.filter((file) =>
      /temporary code/i.test(userFacingText(sources[file]!)),
    );

    expect(offenders).toEqual([]);
  });
});
