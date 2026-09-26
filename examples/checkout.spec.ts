import { test } from '@playwright/test';
import { expect } from 'playwright-jev';

const checkout = new URL('./site/checkout.html', import.meta.url).href;

test.describe('checkout', () => {
  test('a successful payment is communicated as a confirmation', async ({ page }) => {
    await page.goto(checkout);
    await page.getByRole('button', { name: 'Pay now' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).not.toContainText('Processing');

    await Promise.all([
      expect.soft(alert).toMean('the payment was confirmed'),
      expect.soft(alert).toMean('the customer will receive a receipt by e-mail'),
      expect.soft(alert).not.toMean('the payment failed'),
      expect.soft(alert).toChoose(
        {
          success: 'Confirms that something worked',
          error: 'Reports a problem',
          pending: 'Still in progress',
        },
        'success',
      ),
    ]);
  });

  test('a declined card tells the user what to do next', async ({ page }) => {
    await page.goto(checkout);
    await page.locator('#card').fill('4000 0000 0000 0002');
    await page.getByRole('button', { name: 'Pay now' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).not.toContainText('Processing');

    await Promise.all([
      expect.soft(alert).toMean('the payment did not go through'),
      expect.soft(alert).toMean('the user is asked to use a different payment method'),
      expect.soft(alert).not.toMean('the order is confirmed'),
    ]);
  });

  test('the order summary covers what a buyer needs', async ({ page }) => {
    await page.goto(checkout);
    await expect(page.locator('#summary')).toMeanAll([
      'the order total is shown',
      'the page says when the order should arrive',
    ]);
  });
});
