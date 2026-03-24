import { describe, expect, it, vi } from 'vitest';

import { CodexSDKClient } from './codex.js';
import { GeminiSDKClient } from './gemini.js';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createCodexClient(): CodexSDKClient {
  return new CodexSDKClient({
    provider: 'codex',
    cwd: process.cwd(),
    permissionMode: 'strict',
    outputThrottleMs: 0,
  });
}

function createGeminiClient(): GeminiSDKClient {
  return new GeminiSDKClient({
    provider: 'gemini',
    cwd: process.cwd(),
    permissionMode: 'strict',
    outputThrottleMs: 0,
  });
}

describe('SDK turn completion regression', () => {
  it('keeps Codex sendMessage pending until the turn completes', async () => {
    const client = createCodexClient();
    const gate = createDeferred();
    const turnId = 'turn-codex-1';

    (client as any).client = {
      send: vi.fn(() => ({
        updates: async function* () {
          yield {
            kind: 'started',
            turnId,
            snapshot: {
              currentOutputKind: 'idle',
            },
          };

          yield {
            kind: 'output',
            turnId,
            snapshot: {
              currentOutputKind: 'text',
              text: 'Hello from Codex',
            },
          };

          await gate.promise;

          yield {
            kind: 'completed',
            turnId,
            snapshot: {
              currentOutputKind: 'text',
              text: 'Hello from Codex',
            },
          };
        },
        done: Promise.resolve({ providerThreadId: 'codex-thread-2' }),
      })),
      providerThreadId: 'codex-thread-1',
      getOpenRequests: () => [],
    };

    const sendPromise = client.sendMessage({ role: 'user', content: 'hi' });
    let settled = false;
    sendPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await sendPromise;
    expect(settled).toBe(true);
  });

  it('keeps Gemini sendMessage pending until the turn completes', async () => {
    const client = createGeminiClient();
    const gate = createDeferred();
    const turnId = 'turn-gemini-1';

    (client as any).client = {
      send: vi.fn(() => ({
        updates: async function* () {
          yield {
            kind: 'started',
            turnId,
            snapshot: {
              currentOutputKind: 'idle',
            },
          };

          yield {
            kind: 'output',
            turnId,
            snapshot: {
              currentOutputKind: 'text',
              text: 'Hello from Gemini',
            },
          };

          await gate.promise;

          yield {
            kind: 'completed',
            turnId,
            snapshot: {
              currentOutputKind: 'text',
              text: 'Hello from Gemini',
              sessionId: 'gemini-session-2',
            },
          };
        },
        done: Promise.resolve({ sessionId: 'gemini-session-2' }),
      })),
      sessionId: 'gemini-session-1',
    };

    const sendPromise = client.sendMessage({ role: 'user', content: 'hi' });
    let settled = false;
    sendPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await sendPromise;
    expect(settled).toBe(true);
  });
});
