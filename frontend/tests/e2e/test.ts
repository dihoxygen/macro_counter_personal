import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * The `test` every spec uses, except splash.spec.ts. Its pages start with the splash intro already
 * "played this session" (feature 005), the same flag a reload sets, so the 10 s overlay never blocks them.
 * Production code gets no test switch.
 */
export const test = base.extend<{ closeOtherContexts: void }>({
  // `provide`, not Playwright's usual `use`: the React hooks lint rule would read `use(...)` as a hook call.
  context: async ({ context }, provide) => {
    await context.addInitScript(() => sessionStorage.setItem('macro.introPlayed', '1'));
    await provide(context);
  },
  // Contexts a test opened itself (a second device, say) would otherwise stay open for the rest of the
  // worker and pile up. Playwright closes `context`; closing the others keeps their traces and failure
  // screenshots, which it collects as a context closes.
  closeOtherContexts: [
    async ({ browser, context }, provide) => {
      await provide();
      await Promise.all(
        browser
          .contexts()
          .filter((other) => other !== context)
          .map((other) => other.close()),
      );
    },
    { auto: true },
  ],
});
