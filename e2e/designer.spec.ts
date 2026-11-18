import { expect, test, type Browser, type Page } from '@playwright/test';
import { logIn } from './helpers.js';

// The master designer: a small master built from a skeleton, a master-check problem found and fixed, then the review
// and approval workflow with three people, each in their own browser (TA-02).

async function as(browser: Browser, who: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await logIn(page, who);
  await page.getByRole('button', { name: 'Master records' }).click();
  return page;
}
// Opens the master's review again, as read now.
async function review(page: Page) {
  await page.getByRole('button', { name: '← Master records' }).click();
  await page.getByRole('row', { name: /API-001/ }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Review and approval' }).click();
}
// Signing opens core's password window; the stand-in answers at once and the window closes itself.
async function sign(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sign' }).click();
  await expect(dialog).toBeHidden();
}

test('TA-02 build a master from a skeleton, fix a master-check problem, then check, approve and (another QA person) make it effective', async ({ browser }) => {
  const author = await as(browser, 'author1');
  await author.getByRole('button', { name: 'New master' }).click();
  // The API is a material of master data (so MMS can stock its lots).
  await author.getByLabel('API', { exact: true }).fill('API-001');
  await author.getByRole('button', { name: /API-001/ }).click();
  await author.getByLabel('Batch size (kg of API expected)').fill('100.0');
  await author.getByLabel('Retest period (months)').fill('36');
  // A new master names no dispensing rooms; the rooms with a weighing balance are listed first, by name.
  await expect(author.getByText('None chosen yet: choose the rooms of master data where the materials are weighed')).toBeVisible();
  await author.getByLabel('Add to dispensing rooms (where the materials are weighed)').selectOption({ label: 'DSP-01 · Dispensing booth 1 (Dispensing)' });
  await author.getByText('Process skeleton: Blending of released batches').click();
  await author.getByRole('button', { name: 'Create draft' }).click();
  await expect(author.getByRole('heading', { name: 'API-001 · Examplone hydrochloride' })).toBeVisible();

  // The formula: the released API lots blended (the stage's starting material) and the drum labels of Pack and label.
  await author.getByRole('button', { name: 'Formula', exact: true }).click();
  await author.getByRole('button', { name: '+ Add a material' }).click();
  await author.getByLabel('Material').fill('API-001');
  await author.getByRole('button', { name: /API-001/ }).click();
  await author.getByLabel('Quantity of Examplone hydrochloride').fill('100.0');
  await author.getByLabel('Role of Examplone hydrochloride').selectOption('starting material');
  await expect(author.locator('.formula-table')).toContainText('100.000 kg');
  await author.getByRole('button', { name: '+ Add a material' }).click();
  await author.getByLabel('Material').fill('PM-101');
  await author.getByRole('button', { name: /PM-101/ }).click();
  await author.getByLabel('Stage of Drum label').selectOption({ label: 'Pack and label' });
  await author.getByLabel('Role of Drum label').selectOption('packing material');
  await author.getByLabel('Unit of Drum label').selectOption('units');
  await author.getByLabel('Quantity of Drum label').fill('10');

  // The process: Blending and Pack and label, each starting with line clearance (TA-10).
  await author.getByRole('button', { name: 'Process', exact: true }).click();
  await expect(author.locator('.steps-col .olist li').first()).toContainText('Line clearance');
  await expect(author.locator('.steps-col .olist li')).toHaveCount(6);
  // The stage yield: its theoretical quantity, used in two sentences, is one input; More options opens per step.
  await author.locator('.steps-col').getByRole('button', { name: /6\. Stage yield/ }).click();
  await expect(author.locator('.settings-col').getByLabel('Theoretical quantity', { exact: true })).toHaveCount(1);
  await author.getByText('More options').click();
  await author.locator('.steps-col').getByRole('button', { name: /4\. Mix/ }).click();
  await expect(author.locator('.settings-col details.more')).not.toHaveAttribute('open');

  // The master check shows what is missing; its link selects the step, and the template sentence takes the input.
  const check = author.getByRole('complementary', { name: 'Master check' });
  await check.getByRole('button', { name: /Target quantity is not set/ }).click();
  await expect(author.getByRole('heading', { name: 'Weigh a material' })).toBeVisible();
  const sentence = author.locator('.sentence', { hasText: 'must be within ±' });
  await sentence.getByLabel('Target quantity').selectOption({ label: 'Examplone hydrochloride' });
  await expect(author.locator('.ex-results')).toContainText('100.0 kg per batch = 100.000 kg');
  await expect(check.getByRole('button', { name: /Target quantity is not set/ })).toBeHidden();

  await check.getByRole('button', { name: /Material \(formula line\) is not set/ }).click();
  await author.getByLabel('Material (formula line)').selectOption({ label: 'API-001 Examplone hydrochloride' });
  for (let i = 0; i < 3; i++) {
    await check.getByRole('button', { name: /Quantity to take is not set/ }).first().click();
    await author.getByLabel('Quantity to take: lowest').fill('50');
    await author.getByLabel('Quantity to take: highest').fill('60');
  }
  await check.getByRole('button', { name: /Packing material is not set/ }).click();
  await author.getByLabel('Packing material', { exact: true }).selectOption({ label: 'PM-101 Drum label' });
  await check.getByRole('button', { name: /Printed material is not set/ }).click();
  await author.getByLabel('Printed material').selectOption({ label: 'PM-101 Drum label' });
  // TA-11: the stages name their rooms in the skeleton (Blending, Packing).
  await expect(check).toContainText('No problems');
  await expect(author.getByRole('status')).toHaveText('All changes saved');

  // Sent for review: the author signs "prepared".
  await author.getByRole('button', { name: 'Review and approval' }).click();
  await expect(author.locator('.plain-view')).toContainText('The net weight must be within ± 0.5 % of the batch quantity of Examplone hydrochloride.');
  await author.getByRole('button', { name: 'Send for review' }).click();
  await sign(author);
  await expect(author.locator('.d-title')).toContainText('In review');

  // A second person returns it with a long reason, then checks it once sent again, in their own browser.
  const checker = await as(browser, 'mcheck1');
  await checker.getByRole('row', { name: /API-001/ }).getByRole('button', { name: 'Open' }).click();
  await checker.getByRole('button', { name: 'Return to the author' }).click();
  await checker.getByLabel('Reason').fill(`Returned for the re-test: ${'the approval under a change control of another product was tried and must be refused, '.repeat(5)}see QMS/change-controls/CC-2026-0007/approval-history/without-a-single-break-in-this-long-reference-to-the-record.`);
  await checker.getByRole('dialog').getByRole('button', { name: 'Return' }).click();
  await expect(checker.locator('.timeline')).toContainText('Returned to the author');
  await review(author);
  await author.getByRole('button', { name: 'Send for review' }).click();
  await sign(author);
  await expect(author.locator('.d-title')).toContainText('In review');
  await review(checker);
  await checker.getByRole('button', { name: 'Pass the check' }).click();
  await sign(checker);
  await expect(checker.locator('.timeline')).toContainText('Checked (passed) · MCHECK1');

  // QA approves with a change control number, then makes it effective. At 1366×900 the review history with the long
  // reason wraps in its column: nothing lies over the Approve button.
  const qa = await as(browser, 'qa1', { width: 1366, height: 900 });
  await qa.getByRole('row', { name: /API-001/ }).getByRole('button', { name: 'Open' }).click();
  const approve = qa.getByRole('button', { name: 'Approve' });
  await expect(qa.locator('.timeline')).toContainText('without-a-single-break');
  const box = (await approve.boundingBox())!;
  expect(await qa.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent, [box.x + box.width / 2, box.y + box.height / 2])).toBe('Approve');
  const timeline = (await qa.locator('.timeline').boundingBox())!;
  expect(timeline.x + timeline.width).toBeLessThanOrEqual(box.x);
  await approve.click();
  await qa.getByLabel('Change control number').fill('CC-2026-031');
  await qa.getByRole('button', { name: 'Continue to sign' }).click();
  await sign(qa);
  await expect(qa.locator('.d-title')).toContainText('Approved');
  // No QMS link here: the number was typed by hand, so another person makes the version effective.
  await expect(qa.getByRole('button', { name: 'Make effective' })).toBeDisabled();
  await expect(qa.locator('.review-actions')).toContainText('another person makes the version effective');
  const qa2 = await as(browser, 'qa2');
  await qa2.getByRole('row', { name: /API-001/ }).getByRole('button', { name: 'Open' }).click();
  await qa2.getByRole('button', { name: 'Make effective' }).click();
  await qa2.getByRole('dialog').getByRole('button', { name: 'Make effective' }).click();
  await expect(qa2.locator('.d-title')).toContainText('Effective');
  await expect(qa2.locator('.timeline')).toContainText('change control CC-2026-031');
});
