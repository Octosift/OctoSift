import { expect, test, type Page } from '@playwright/test';

// The app runs in demo mode on a fresh database (see playwright.config.ts).
// Onboarding creates the leads that the later tests work with.
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  // Opening a thread must not leave the machine during tests.
  await context.route('https://www.reddit.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>thread</p>' }),
  );
  page = await context.newPage();
});

test.afterAll(async () => {
  await page.context().close();
});

test('onboarding in demo mode ends in an inbox with leads', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Connect a Reddit account' })).toBeVisible();
  await expect(page.getByText('Demo source', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What did you build?' })).toBeVisible();

  await page.getByRole('button', { name: 'Read my site' }).click();
  await expect(page.getByRole('heading', { name: 'Check the profile' })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Acme Invoices');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByText('r/sidehustle_demo')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByRole('button', { name: 'Start the first scan' }).click();
  await expect(page.getByRole('button', { name: 'Open the inbox', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // The scan itself finds the suggested subreddit that does not exist.
  await expect(page.getByText(/r\/not_a_real_demo does not exist/)).toBeVisible();
  await page.getByRole('button', { name: 'Open the inbox', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox/);
  await expect(page.getByRole('list', { name: 'Leads' }).getByRole('link')).not.toHaveCount(0);
});

test('the keyboard moves through the inbox', async () => {
  await page.goto('/inbox');
  const rows = page.getByRole('list', { name: 'Leads' }).getByRole('link');
  const first = await rows.nth(0).getAttribute('data-lead-id');
  const second = await rows.nth(1).getAttribute('data-lead-id');
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('j');
  await expect(page).toHaveURL(new RegExp(`lead=${second ?? ''}`));
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('k');
  await expect(page).toHaveURL(new RegExp(`lead=${first ?? ''}`));

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('copy and open copies the draft, opens the thread and marks the lead replied', async () => {
  await page.goto('/inbox');
  const draft = await page.getByRole('textbox', { name: 'Reply draft' }).inputValue();
  expect(draft.length).toBeGreaterThan(50);
  const repliedBefore = Number(
    await page
      .getByRole('link', { name: /^Replied/ })
      .locator('span')
      .innerText(),
  );

  const popup = page.context().waitForEvent('page');
  await page.keyboard.press('c');
  const thread = await popup;
  await expect(thread).toHaveURL(/reddit\.com\/r\/.+\/comments\//);
  await thread.close();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(draft);

  const dialog = page.getByRole('dialog', { name: 'Did you post your reply?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Mark as replied' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: /^Replied/ }).locator('span')).toHaveText(
    String(repliedBefore + 1),
  );
});

test('copy and open stays disabled until a lead has a draft', async () => {
  await page.goto('/inbox');
  await page
    .getByRole('list', { name: 'Leads' })
    .getByRole('link')
    .filter({ hasNotText: 'Draft ready' })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Copy and open thread/ })).toBeDisabled();
  await expect(page.getByText('Write a draft first.')).toBeVisible();
});

test('the evergreen tab checks the buyer phrases and shows the cost', async () => {
  await page.goto('/inbox?tab=evergreen');
  await expect(page.getByRole('heading', { name: 'Threads that rank on Google' })).toBeVisible();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText(/Found 13 threads for \$0\.024/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Polite way to chase an unpaid invoice?')).toBeVisible();
  await expect(page.getByText('Archived, replies closed').first()).toBeVisible();
});

test('a saved API key is only ever shown as a mask', async () => {
  // Assembled at runtime so the source contains nothing key-shaped.
  const key = ['sk', 'proj', 'e2eOnlyNotARealKey000000wxyz'].join('-');
  await page.goto('/settings');
  await page.getByLabel('OpenAI API key').fill(key);
  await page
    .locator('[data-secret="openai_api_key"]')
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.getByTestId('openai_api_key-mask')).toHaveText('sk-…wxyz');

  await page.reload();
  await expect(page.getByTestId('openai_api_key-mask')).toHaveText('sk-…wxyz');
  expect(await page.content()).not.toContain(key);
  const exported = await page.request.get('/api/export');
  expect(await exported.text()).not.toContain(key);
});
