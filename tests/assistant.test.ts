import { afterEach, expect, test } from 'bun:test';
import { assistantConfigured, runAssistant } from '../packages/database/src/assistant';

const ENV_KEYS = ['QB_AI_BASE_URL', 'QB_AI_API_KEY', 'QB_AI_MODEL', 'NODE_ENV'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function configure(base = 'https://llm.example.com/v1') {
  process.env.QB_AI_BASE_URL = base;
  process.env.QB_AI_API_KEY = 'test-key';
  process.env.QB_AI_MODEL = 'test-model';
}

test('assistant is unconfigured until base URL, key, and model are set', async () => {
  delete process.env.QB_AI_BASE_URL;
  delete process.env.QB_AI_API_KEY;
  delete process.env.QB_AI_MODEL;
  expect(assistantConfigured()).toBe(false);
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as unknown as typeof fetch;
  try {
    expect(
      await runAssistant({
        schema: { tables: ['tasks'] },
        policies: [],
        request: { intent: 'explain', prompt: 'what is tasks' },
      }),
    ).toEqual({ proposals: [], model: '', configured: false });
    expect(called).toBe(false);
  } finally {
    globalThis.fetch = original;
  }
});

test('assistant posts schema without fixture rows and records a migration review', async () => {
  configure();
  const original = globalThis.fetch;
  const logs: unknown[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
  let reviewed: { sql: string; migrationId: string } | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://llm.example.com/v1/chat/completions');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('test-model');
    const system = body.messages[0].content as string;
    expect(system).toContain('tasks');
    expect(system).toContain('Intent: migration');
    expect(system).not.toContain('row-secret-value');
    expect(String(init?.body)).not.toContain('row-secret-value');
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              proposals: [
                {
                  kind: 'migration',
                  title: 'Add title',
                  body: 'Adds a title column',
                  migrationId: 'add-title',
                  sql: 'ALTER TABLE tasks ADD COLUMN title TEXT',
                },
              ],
            }),
          },
        },
      ],
    });
  }) as unknown as typeof fetch;
  try {
    const response = await runAssistant({
      schema: { tables: [{ name: 'tasks', columns: ['id'] }] },
      policies: [],
      request: {
        intent: 'migration',
        prompt: 'add a title column',
        fixtures: { tasks: [{ id: 'row-secret-value' }] },
        includeRows: false,
      },
      createReview: async (sql, migrationId) => {
        reviewed = { sql, migrationId };
        return 'review-1';
      },
    });
    expect(response.configured).toBe(true);
    expect(response.model).toBe('test-model');
    expect(response.proposals).toEqual([
      {
        kind: 'migration',
        title: 'Add title',
        body: 'Adds a title column',
        migrationId: 'add-title',
        reviewId: 'review-1',
      },
    ]);
    expect(reviewed!).toEqual({
      sql: 'ALTER TABLE tasks ADD COLUMN title TEXT',
      migrationId: 'add-title',
    });
    expect(JSON.stringify(logs)).not.toContain('add a title column');
    expect(JSON.stringify(logs)).not.toContain('test-key');
  } finally {
    globalThis.fetch = original;
    console.log = log;
  }
});

test('assistant includes fixture rows only when the developer opts in', async () => {
  configure();
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(init?.body)).toContain('row-secret-value');
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              proposals: [{ kind: 'explanation', title: 'Ownership', body: 'Alice owns the row' }],
            }),
          },
        },
      ],
    });
  }) as unknown as typeof fetch;
  try {
    const response = await runAssistant({
      schema: { tables: ['tasks'] },
      policies: [],
      request: {
        intent: 'explain',
        prompt: 'who can read this',
        includeRows: true,
        fixtures: { tasks: [{ id: 'row-secret-value' }] },
      },
      createReview: async () => {
        throw new Error('explanations are not reviews');
      },
    });
    expect(response.proposals[0]?.reviewId).toBeUndefined();
    expect(response.proposals[0]?.kind).toBe('explanation');
  } finally {
    globalThis.fetch = original;
  }
});

test('assistant rejects private and link-local base URLs', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}');
  }) as unknown as typeof fetch;
  try {
    process.env.NODE_ENV = 'production';
    configure('https://127.0.0.1/v1');
    await expect(
      runAssistant({
        schema: {},
        policies: [],
        request: { intent: 'explain', prompt: 'hello' },
      }),
    ).rejects.toThrow('private or link-local');
    process.env.NODE_ENV = 'test';
    configure('http://169.254.169.254/v1');
    await expect(
      runAssistant({
        schema: {},
        policies: [],
        request: { intent: 'policy', prompt: 'hello' },
      }),
    ).rejects.toThrow('private or link-local');
    expect(called).toBe(false);
  } finally {
    globalThis.fetch = original;
  }
});
