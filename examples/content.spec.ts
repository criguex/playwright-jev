import { test } from '@playwright/test';
import { expect } from 'playwright-jev';

const article = new URL('./site/article.html', import.meta.url).href;

test('the help article explains the steps clearly', async ({ page }) => {
  await page.goto(article);
  await expect(page.locator('#article')).toBeScored(
    {
      question: 'How clearly does `content` explain how to reset a password?',
      levels: [
        'Does not explain it',
        'Explains it partially or vaguely',
        'Explains every step clearly',
      ],
    },
    { atLeast: 1.5 },
  );
});

test('an API payload means what the contract says', async () => {
  const payload = { order: { id: 'A-1001', status: 'SHIPPED', carrier: 'DHL', eta_days: 3 } };
  await expect(payload).toMeanAny(['the order has been shipped', 'the order was delivered']);
});
