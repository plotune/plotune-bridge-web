import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const dbc = 'BO_ 100 Sample: 1 ECU\n SG_ Value : 0|8@1+ (1,0) [0|255] "V" ECU\n';

test('BWEB-010 r2: another browser requests matching local files without transferring DBC contents', async ({ page, browser }) => {
  await page.addInitScript((text) => localStorage.setItem('bw.dbc', JSON.stringify({ version: 2, files: [{ source: 'Bridge 1', channel: 1, fileName: 'bench.dbc', text }] })), dbc);
  await page.goto('/');
  await page.getByTestId('empty-canvas').getByRole('button', { name: 'Trace', exact: true }).click();
  await page.getByRole('button', { name: /workspace menu/ }).click();
  await page.getByRole('menuitem', { name: 'Export or import…' }).click();
  const output = page.getByLabel('Workspace file contents');
  await expect(output).toHaveValue(/sha256/);
  const json = await output.inputValue();
  expect(json).not.toContain('BO_');
  expect(JSON.parse(json).databaseReferences).toHaveLength(1);

  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    const uploads: string[] = [];
    other.on('request', (r) => { if (r.method() !== 'GET') uploads.push(r.url()); });
    await other.goto('/');
    await other.getByRole('button', { name: /workspace menu/ }).click();
    await other.getByRole('menuitem', { name: 'Export or import…' }).click();
    await other.getByLabel('Paste a workspace file').fill(json);
    await other.getByRole('button', { name: 'Import', exact: true }).click();
    const picker = other.getByLabel('Relink bench.dbc for Bridge 1 CAN1');
    await expect(picker).toBeVisible();
    expect((await new AxeBuilder({ page: other }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await picker.setInputFiles({ name: 'bench.dbc', mimeType: 'text/plain', buffer: Buffer.from(dbc.replace('Sample', 'Wrong')) });
    await expect(other.getByRole('alert')).toContainText('does not match');
    await picker.setInputFiles({ name: 'bench.dbc', mimeType: 'text/plain', buffer: Buffer.from(dbc) });
    await expect(other.getByRole('alert')).toHaveCount(0);
    await expect(other.getByText('Linked bench.dbc', { exact: true })).toBeVisible();
    expect(uploads).toEqual([]);
    await other.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(other.getByRole('region', { name: 'Trace', exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByRole('region', { name: 'Trace', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
