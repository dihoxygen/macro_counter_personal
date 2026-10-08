import { z } from 'zod';

const StatusSchema = z.object({ aiAvailable: z.boolean() });
export type Status = z.infer<typeof StatusSchema>;

/** Whether AI lookup is available. Any failure counts as "not available", so manual entry is offered. */
export async function getStatus(): Promise<Status> {
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) return { aiAvailable: false };
    const parsed = StatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { aiAvailable: false };
  } catch {
    return { aiAvailable: false };
  }
}
