import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * The `test` every spec uses, except splash.spec.ts. Its pages start with the splash intro already
 * "played this session" (feature 005), the same flag a reload sets, so the 10 s overlay never blocks them.
 * Production code gets no test switch.
 */
export const test = base.extend({
  // `provide`, not Playwright's usual `use`: the React hooks lint rule would read `use(...)` as a hook call.
  context: async ({ context }, provide) => {
    await context.addInitScript(() => sessionStorage.setItem('macro.introPlayed', '1'));
    await provide(context);
  },
});
