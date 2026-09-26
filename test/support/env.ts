import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureJev, resetJevConfig } from '../../src/config.js';
import { resetJevState } from '../../src/engine.js';
import { setTestInfoProvider, type TestInfoLike } from '../../src/evidence.js';

const KEYS = [
  'TYPESAFE_API_KEY',
  'AI_GATEWAY_API_KEY',
  'JEV_BASE_URL',
  'JEV_MODE',
  'JEV_THRESHOLD',
  'JEV_MODEL',
  'JEV_FIXTURES_DIR',
  'JEV_ON_UNVERIFIED',
  'JEV_ON_AMBIGUOUS',
];

export function cleanEnv(): void {
  for (const key of KEYS) Reflect.deleteProperty(process.env, key);
  resetJevConfig();
  resetJevState();
  setTestInfoProvider(() => undefined);
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pwjev-'));
}

export function useMock(url: string, extra: Parameters<typeof configureJev>[0] = {}): void {
  configureJev({
    baseUrl: url,
    apiKey: 'test-key',
    fixturesDir: tempDir(),
    logger: () => {},
    maxRetryDelayMs: 50,
    ...extra,
  });
}

export interface FakeTestInfo extends TestInfoLike {
  attachments: { name: string; body: string }[];
  skipped?: string;
}

export function fakeTestInfo(): FakeTestInfo {
  const info: FakeTestInfo = {
    annotations: [],
    attachments: [],
    async attach(name, { body }) {
      info.attachments.push({ name, body });
    },
    skip(_condition, description) {
      info.skipped = description ?? 'skipped';
      throw new Error(`SKIP: ${description}`);
    },
  };
  return info;
}
