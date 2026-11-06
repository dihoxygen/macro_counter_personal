import { toDayKey } from '../domain/days';
import type { EntryVersion, LogEntry, ProteinGoal, SavedFood } from './records';
import type { EntryRepository, EntryVersionRepository, ProteinGoalRepository, SavedFoodRepository } from './repositories';

const FORMAT = 'macro-counter-export';
const FORMAT_VERSION = 1;

export interface ExportRecords {
  entries: LogEntry[];
  savedFoods: SavedFood[];
  proteinGoals: ProteinGoal[];
  entryVersions: EntryVersion[];
}

export interface ExportFile extends ExportRecords {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  exportedAt: string;
}

/** Just the repositories of the signed-in account: nothing else can reach the file (threat S15). */
export interface ExportSources {
  entries: Pick<EntryRepository, 'listAll'>;
  savedFoods: Pick<SavedFoodRepository, 'listAll'>;
  goals: Pick<ProteinGoalRepository, 'listAll'>;
  entryVersions: Pick<EntryVersionRepository, 'listAll'>;
}

/** The whole document (FR-036). Values go in as stored, so nothing is rounded. */
export function buildExport(records: ExportRecords, exportedAt: Date): ExportFile {
  return { format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt: exportedAt.toISOString(), ...records };
}

export async function readExport(sources: ExportSources, exportedAt: Date): Promise<ExportFile> {
  const [entries, savedFoods, proteinGoals, entryVersions] = await Promise.all([
    sources.entries.listAll(),
    sources.savedFoods.listAll(),
    sources.goals.listAll(),
    sources.entryVersions.listAll(),
  ]);
  return buildExport({ entries, savedFoods, proteinGoals, entryVersions }, exportedAt);
}

export function exportFileName(date: Date): string {
  return `${FORMAT}-${toDayKey(date)}.json`;
}
