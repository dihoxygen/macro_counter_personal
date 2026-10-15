import { z } from 'zod';
import { apiFetch } from './http';

const StatusSchema = z.object({ aiAvailable: z.boolean() });
export type Status = z.infer<typeof StatusSchema>;

/** Whether AI lookup is available. Any failure counts as "not available", so manual entry is offered. */
export async function getStatus(): Promise<Status> {
  try {
    const response = await apiFetch('/api/status', { headers: { Accept: 'application/json' } });
    const parsed = StatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { aiAvailable: false };
  } catch {
    return { aiAvailable: false };
  }
}
