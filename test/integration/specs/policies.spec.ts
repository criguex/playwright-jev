import { test } from '@playwright/test';
import { configureJev, expect, redactors } from '../../../src/index.js';
import { isolate, openCheckout, requestsContaining } from './helpers.js';

test.beforeEach(isolate);

test.describe('policies', () => {
  test('ambiguous answers fail by default', async () => {
    test.fail();
    await expect('payment [[ambiguous]]').toMean('payment confirmed');
  });

  test('ambiguous answers can be annotated instead', async ({}, testInfo) => {
    await expect('payment [[ambiguous]]').toMean('payment confirmed', { onAmbiguous: 'annotate' });
    expect(testInfo.annotations.map((a) => a.type)).toContain('jev:ambiguous');
  });

  test('fails when Jev is unreachable', async () => {
    test.fail();
    configureJev({ baseUrl: 'http://127.0.0.1:9/v1/systemone', maxRetries: 0 });
    await expect('Payment confirmed').toMean('payment confirmed');
  });

  test('fails on server errors instead of passing silently', async () => {
    test.fail();
    await expect('[[http500]] Payment confirmed').toMean('payment confirmed');
  });

  test('times out slow requests as unverified', async () => {
    test.fail();
    configureJev({ requestTimeoutMs: 300 });
    await expect('[[slow]] Payment confirmed').toMean('payment confirmed');
  });

  test('skip-with-warning policy skips the test', async () => {
    configureJev({
      baseUrl: 'http://127.0.0.1:9/v1/systemone',
      maxRetries: 0,
      onUnverified: 'skip',
    });
    await expect('Payment confirmed').toMean('payment confirmed');
    throw new Error('unreachable: the assertion above must skip the test');
  });

  test('redaction removes PII before it leaves the machine', async ({ page }, testInfo) => {
    configureJev({ redact: [redactors.emails, redactors.cardNumbers] });
    const email = `pii-${testInfo.testId}@example.com`;
    await openCheckout(page);
    await page.locator('#email').fill(email);
    await page.getByRole('button', { name: 'Pay now' }).click();
    await expect(page.getByRole('alert')).toMean('receipt sent');
    expect((await requestsContaining(email)).requests).toBe(0);
    expect((await requestsContaining('A receipt was sent to [email]')).requests).toBeGreaterThan(0);
  });

  test('record then replay offline', async ({}, testInfo) => {
    const text = `Order ${testInfo.testId} shipped`;
    configureJev({ mode: 'record' });
    await expect(text).toMean('order shipped');
    configureJev({ mode: 'replay', baseUrl: 'http://127.0.0.1:9/never' });
    const { resetJevState } = await import('../../../src/index.js');
    resetJevState();
    await expect(text).toMean('order shipped');
    const records = testInfo.attachments
      .filter((a) => a.name === 'jev-assertion')
      .map((a) => JSON.parse(String(a.body)));
    expect(records.map((r) => r.questions[0].source)).toEqual(['live', 'fixture']);
  });
});
