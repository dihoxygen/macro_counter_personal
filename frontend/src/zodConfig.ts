import { z } from 'zod';

// The app runs under a strict Content-Security-Policy with no 'unsafe-eval' (research R11). Zod would
// otherwise probe for, and use, `new Function` to compile schemas; jitless keeps it on the plain path.
// Imported first in main.tsx, before any schema is used.
z.config({ jitless: true });
