export interface Migration<Ctx> {
  version: number;
  up: (ctx: Ctx) => void;
}

/**
 * Applies every migration with oldVersion < version ≤ newVersion, in order, exactly once.
 * Throws before running anything if the chain has a gap, a duplicate, or a missing target.
 */
export function runMigrations<Ctx>(
  migrations: readonly Migration<Ctx>[],
  oldVersion: number,
  newVersion: number,
  ctx: Ctx,
): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const versions = sorted.map((m) => m.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error(`duplicate migration versions: ${versions.join(', ')}`);
  }
  for (let v = 1; v <= newVersion; v++) {
    if (!versions.includes(v)) {
      throw new Error(`migration ${v} is missing (version gap in ${versions.join(', ')})`);
    }
  }
  for (const m of sorted) {
    if (m.version > oldVersion && m.version <= newVersion) m.up(ctx);
  }
}
