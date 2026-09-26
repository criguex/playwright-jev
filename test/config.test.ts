import { beforeEach, describe, expect, it } from 'vitest';
import { configureJev, resolveConfig } from '../src/config.js';
import { cleanEnv } from './support/env.js';

beforeEach(cleanEnv);

describe('config', () => {
  it('has safe defaults', () => {
    const config = resolveConfig();
    expect(config).toMatchObject({
      mode: 'auto',
      model: 'jev-latest',
      threshold: 0.8,
      onAmbiguous: 'fail',
      onUnverified: 'fail',
      fixturesDir: '.jev/fixtures',
    });
    expect(config.apiKey).toBeUndefined();
  });

  it('reads environment variables', () => {
    Object.assign(process.env, {
      JEV_MODE: 'replay',
      JEV_MODEL: 'jev-1.13.0',
      JEV_THRESHOLD: '0.9',
      JEV_ON_AMBIGUOUS: 'annotate',
      JEV_ON_UNVERIFIED: 'skip',
      JEV_FIXTURES_DIR: 'fx',
      TYPESAFE_API_KEY: ' k ',
      JEV_BASE_URL: 'http://localhost:1',
    });
    expect(resolveConfig()).toMatchObject({
      mode: 'replay',
      model: 'jev-1.13.0',
      threshold: 0.9,
      onAmbiguous: 'annotate',
      onUnverified: 'skip',
      fixturesDir: 'fx',
      apiKey: 'k',
      baseUrl: 'http://localhost:1',
    });
  });

  it('rejects invalid environment values', () => {
    process.env.JEV_MODE = 'sometimes';
    expect(() => resolveConfig()).toThrow(/JEV_MODE/);
    cleanEnv();
    process.env.JEV_THRESHOLD = '2';
    expect(() => resolveConfig()).toThrow(/JEV_THRESHOLD/);
  });

  it('applies configureJev over env and per-call overrides over both', () => {
    process.env.JEV_THRESHOLD = '0.7';
    configureJev({ threshold: 0.85 });
    expect(resolveConfig().threshold).toBe(0.85);
    expect(resolveConfig({ threshold: 0.95 }).threshold).toBe(0.95);
    configureJev({ mode: 'off' });
    expect(resolveConfig()).toMatchObject({ threshold: 0.85, mode: 'off' });
  });

  it('validates numeric settings', () => {
    expect(() => configureJev({ threshold: 0.5 })).toThrow(/threshold/);
    cleanEnv();
    expect(() => resolveConfig({ minConfidence: 2 })).toThrow(/minConfidence/);
    expect(() => resolveConfig({ maxQuestionsPerRequest: 0 })).toThrow(/maxQuestionsPerRequest/);
  });

  it('ignores empty environment values', () => {
    process.env.JEV_MODE = '';
    process.env.JEV_THRESHOLD = '';
    process.env.TYPESAFE_API_KEY = '   ';
    expect(resolveConfig()).toMatchObject({ mode: 'auto', threshold: 0.8, apiKey: undefined });
  });
});
