import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockRequest {
  headers: IncomingMessage['headers'];
  body: {
    model: string;
    state: { content?: unknown; context?: string } | string;
    questions: Record<string, { type: string; instructions: unknown; criteria?: unknown }>;
  };
}

export interface MockReply {
  status?: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

export type MockHandler = (request: MockRequest, index: number) => MockReply | undefined;

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);

function contentOf(state: MockRequest['body']['state']): string {
  if (typeof state === 'string') return state;
  const content = state.content;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function claimOf(instructions: unknown): string {
  if (typeof instructions === 'string') return instructions;
  const record = instructions as Record<string, unknown>;
  return String(record.claim ?? record.question ?? '');
}

export function lexicalAnswer(request: MockRequest): Record<string, unknown> {
  const content = contentOf(request.body.state);
  const lower = content.toLowerCase();
  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(request.body.questions)) {
    if (question.type === 'noul') {
      const terms = words(claimOf(question.instructions));
      const hits = terms.filter((t) => lower.includes(t)).length;
      let p = terms.length === 0 ? 0.5 : hits === terms.length ? 0.96 : hits === 0 ? 0.03 : 0.5;
      if (lower.includes('[[ambiguous]]')) p = 0.55;
      answers[id] = { type: 'noul', noul: p };
    } else if (question.type === 'choice') {
      const options = Object.keys(question.criteria as Record<string, unknown>);
      const picked = options.find((o) => lower.includes(o.toLowerCase())) ?? options[0]!;
      const low = lower.includes('[[ambiguous]]');
      const probabilities = Object.fromEntries(
        options.map((o) => [
          o,
          o === picked ? (low ? 0.4 : 0.9) : (low ? 0.6 : 0.1) / (options.length - 1),
        ]),
      );
      answers[id] = { type: 'choice', choice: picked, probabilities, confidence: low ? 0.1 : 0.85 };
    } else {
      const levels = question.criteria as string[];
      const match = /\[\[score:(\d+(?:\.\d+)?)\]\]/.exec(lower);
      const score = match ? Number(match[1]) : levels.length - 1;
      const top = Math.round(score);
      const probabilities = Object.fromEntries(
        levels.map((_, i) => [String(i), i === top ? 0.9 : 0.1 / (levels.length - 1)]),
      );
      answers[id] = {
        type: 'score',
        score,
        legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
        probabilities,
        confidence: lower.includes('[[ambiguous]]') ? 0.1 : 0.8,
      };
    }
  }
  return answers;
}

export interface MockJev {
  url: string;
  requests: MockRequest[];
  handler: MockHandler | undefined;
  gatewayShape: boolean;
  close(): Promise<void>;
}

export async function startMockJev(): Promise<MockJev> {
  const state: Omit<MockJev, 'url' | 'close'> = {
    requests: [],
    handler: undefined,
    gatewayShape: false,
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const request: MockRequest = { headers: req.headers, body: JSON.parse(raw || '{}') };
      const index = state.requests.push(request) - 1;
      const content = contentOf(request.body.state ?? '').toLowerCase();
      let reply = state.handler?.(request, index);
      if (!reply && content.includes('[[http500]]'))
        reply = { status: 500, body: { error: 'boom' } };
      if (!reply && content.includes('[[slow]]')) reply = { delayMs: 3000 };
      const send = () => {
        if (reply?.raw !== undefined) {
          res.writeHead(reply.status ?? 200, reply.headers ?? {});
          res.end(reply.raw);
          return;
        }
        let answers = lexicalAnswer(request);
        if (state.gatewayShape) {
          answers = Object.fromEntries(
            Object.entries(answers).map(([k, v]) => {
              const a = v as { type: string; noul?: number };
              return [k, a.type === 'noul' ? { type: 'boolean', probability: a.noul } : a];
            }),
          );
        }
        const body = reply?.body ?? {
          model: 'jev-mock-1.0',
          answers,
          usage: { input_tokens: 300, output_tokens: 20 },
        };
        res.writeHead(reply?.status ?? 200, {
          'content-type': 'application/json',
          ...(reply?.headers ?? {}),
        });
        res.end(JSON.stringify(body));
      };
      if (reply?.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const mock = state as MockJev;
  mock.url = `http://127.0.0.1:${port}/v1/systemone`;
  mock.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return mock;
}
