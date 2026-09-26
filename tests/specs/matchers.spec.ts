import { test } from '@playwright/test';
import { expect } from '../../src/index.js';
import { isolate, openCheckout, requestsContaining } from './helpers.js';

test.beforeEach(isolate);

test.describe('semantic matchers against the checkout page', () => {
  test('toMean waits for the alert to change meaning (web-first)', async ({ page }) => {
    await openCheckout(page);
    await page.getByRole('button', { name: 'Pay now' }).click();
    await expect(page.getByRole('alert')).toMean('payment successful order confirmed');
  });

  test('.not.toMean and a declined card', async ({ page }) => {
    await openCheckout(page, '4000 0000 0000 0002');
    await page.getByRole('button', { name: 'Pay now' }).click();
    await expect(page.getByRole('alert')).toMean('card declined');
    await expect(page.getByRole('alert')).not.toMean('payment successful');
  });

  test('toMeanAll sends all claims in one request', async ({ page }) => {
    await openCheckout(page);
    const summary = page.locator('#summary');
    await expect(summary).toMeanAll(['order total $25.00', 'delivery estimated', 'items']);
    const seen = await requestsContaining('Delivery estimated');
    expect(seen.requests).toBe(1);
    expect(seen.questions).toEqual([3]);
  });

  test('concurrent soft assertions on the same content are batched', async ({ page }) => {
    await openCheckout(page);
    const help = page.locator('#help');
    await Promise.all([
      expect.soft(help).toMean('contact support'),
      expect.soft(help).toMean('refunds processed'),
      expect.soft(help).not.toMean('account deleted'),
    ]);
    const seen = await requestsContaining('Refunds are processed');
    expect(seen.requests).toBe(1);
    expect(seen.questions).toEqual([3]);
  });

  test('toMeanAny, toChoose and toBeScored on the page', async ({ page }) => {
    await openCheckout(page);
    await expect(page.locator('#summary')).toMeanAny(['refund issued', 'delivery estimated']);
    await expect(page.locator('#help')).toChoose(
      { support: 'Explains how to get support', marketing: 'Promotes a product' },
      'support',
    );
    await expect(page).toBeScored(['unusable', 'basic', 'complete checkout'], { atLeast: 1 });
  });

  test('JSON and API-like values are judged as structured state', async () => {
    await expect({ order: 'A-1001', status: 'shipped' }).toMean('status shipped');
    await expect('Order A-1001 shipped').not.toMean('order cancelled');
  });

  test('every assertion is attached as evidence', async ({ page }, testInfo) => {
    await openCheckout(page);
    await expect(page.locator('#summary')).toMean('delivery estimated');
    const attachment = testInfo.attachments.find((a) => a.name === 'jev-assertion');
    const record = JSON.parse(String(attachment?.body));
    expect(record).toMatchObject({ matcher: 'toMean', status: 'passed', receiver: 'locator' });
    expect(record.questions[0].probability).toBeGreaterThanOrEqual(0.8);
    expect(testInfo.annotations.some((a) => a.type === 'jev')).toBe(true);
  });
});
