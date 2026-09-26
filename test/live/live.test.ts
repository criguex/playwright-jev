import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createJevClient } from '../../src/client.js';
import { claimQuestion } from '../../src/questions.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const hasKey = Boolean(process.env.TYPESAFE_API_KEY || process.env.AI_GATEWAY_API_KEY);

describe.skipIf(!hasKey)('live Jev smoke', () => {
  it('separates a true claim from a false one', async () => {
    const jev = createJevClient({
      maxRetries: 4,
      maxRetryDelayMs: 65_000,
      requestTimeoutMs: 280_000,
    });
    const res = await jev.ask(
      { content: 'Payment successful. Your order A-1001 is confirmed.' },
      { yes: claimQuestion('the payment was confirmed'), no: claimQuestion('the payment failed') },
    );
    console.log(
      `live: ${res.model} via ${res.transport}, ${res.latencyMs} ms, ${res.usage.inputTokens} input tokens`,
    );
    expect(res.answers.yes).toMatchObject({ type: 'noul' });
    expect((res.answers.yes as { probability: number }).probability).toBeGreaterThanOrEqual(0.8);
    expect((res.answers.no as { probability: number }).probability).toBeLessThanOrEqual(0.2);
  }, 300_000);
});
