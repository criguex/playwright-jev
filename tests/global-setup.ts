import { startMockJev } from '../test/support/mock-jev.js';

export default async function globalSetup() {
  const mock = await startMockJev();
  process.env.JEV_BASE_URL = mock.url;
  process.env.TYPESAFE_API_KEY = 'integration-key';
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.JEV_MODE;
  return async () => {
    await mock.close();
  };
}
