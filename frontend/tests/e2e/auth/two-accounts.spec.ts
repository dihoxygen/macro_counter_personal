import { expect, test } from '../test';
import { invite, uniqueUsername } from './db';
import {
  completeSetup,
  logManually,
  nextCode,
  PASSWORD,
  setProteinGoal,
  signIn,
  signOut,
} from './flows';

// SC-007 / US4 / quickstart V7: two people on one browser never see each other's data.
// Two freshly invited accounts per project, so this never collides with other specs.

test('two people on one browser see only their own food, saved foods and goal', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name.replace('auth-', '');
  const first = uniqueUsername(`${project}a`);
  const second = uniqueUsername(`${project}b`);
  await page.goto('/');

  // The first person logs two foods and sets a goal, then signs out.
  const ownerKey = await completeSetup(page, first, invite(first));
  await logManually(page, 'Owner oats', 12);
  await logManually(page, 'Owner eggs', 13);
  await setProteinGoal(page, 140);
  await signOut(page);

  // The second person sees nothing of the first's, and logs one food.
  await completeSetup(page, second, invite(second));
  await expect(page.getByText('Owner oats')).toHaveCount(0);
  await expect(page.getByText('Owner eggs')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /set a protein goal/i })).toBeVisible();
  // Feature 004: saved foods show as quick picks on Today. The second person has none, so neither the
  // group nor any of the first person's foods appear.
  await expect(page.getByRole('group', { name: 'Recent foods' })).toHaveCount(0);
  await expect(page.getByText(/owner/i)).toHaveCount(0);
  await logManually(page, 'Friend toast', 4);
  await signOut(page);

  // The first person's data is all still there, and none of the second's.
  await signIn(page, first, PASSWORD, nextCode(ownerKey));
  const entries = page.getByRole('list', { name: /entries/i });
  await expect(entries).toContainText('Owner oats');
  await expect(entries).toContainText('Owner eggs');
  await expect(entries).not.toContainText('Friend toast');
  await expect(page.getByRole('region', { name: /protein goal/i })).toContainText('25 / 140 g');
});
