import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { configureJev, resetJevConfig, resetJevState } from '../../src/index.js';

export const checkoutUrl = new URL('../site/checkout.html', import.meta.url).href;

export async function openCheckout(page: Page, card?: string): Promise<void> {
  await page.goto(checkoutUrl);
  if (card) await page.locator('#card').fill(card);
}

export function isolate(): void {
  resetJevConfig();
  resetJevState();
  configureJev({ fixturesDir: mkdtempSync(join(tmpdir(), 'pwjev-it-')), logger: () => {} });
}

export async function requestsContaining(
  marker: string,
): Promise<{ requests: number; questions: number[] }> {
  const url = new URL(process.env.JEV_BASE_URL as string);
  url.searchParams.set('contains', marker);
  const response = await fetch(url);
  return (await response.json()) as { requests: number; questions: number[] };
}
