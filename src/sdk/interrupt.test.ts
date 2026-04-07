import { describe, expect, it, vi } from 'vitest';

import { ClaudeSDKClient } from './claude.js';
import { CodexSDKClient } from './codex.js';
import { GeminiSDKClient } from './gemini.js';

describe('SDK client interrupts', () => {
  it('interrupts the current Claude turn', async () => {
    const client = new ClaudeSDKClient({
      provider: 'claude',
      cwd: process.cwd(),
      permissionMode: 'strict',
      outputThrottleMs: 0,
    });
    const interruptTurn = vi.fn(async () => undefined);

    (client as any).client = {
      interruptTurn,
      getCurrentTurn: () => ({ status: 'running' }),
      getOpenRequests: () => [],
    };

    const interrupted = await client.interrupt();

    expect(interruptTurn).toHaveBeenCalledOnce();
    expect(interrupted).toBe(true);
    expect(client.status).toBe('idle');
  });

  it('interrupts the current Codex turn', async () => {
    const client = new CodexSDKClient({
      provider: 'codex',
      cwd: process.cwd(),
      permissionMode: 'strict',
      outputThrottleMs: 0,
    });
    const interruptCurrentTurn = vi.fn(async () => null);

    (client as any).client = {
      interruptCurrentTurn,
      getCurrentTurn: () => ({ status: 'running' }),
      getOpenRequests: () => [],
    };

    const interrupted = await client.interrupt();

    expect(interruptCurrentTurn).toHaveBeenCalledOnce();
    expect(interrupted).toBe(true);
    expect(client.status).toBe('idle');
  });

  it('interrupts the current Gemini turn', async () => {
    const client = new GeminiSDKClient({
      provider: 'gemini',
      cwd: process.cwd(),
      permissionMode: 'strict',
      outputThrottleMs: 0,
    });
    const interrupt = vi.fn(async () => undefined);

    (client as any).client = {
      interrupt,
      getCurrentTurn: () => ({ status: 'running' }),
    };

    const interrupted = await client.interrupt();

    expect(interrupt).toHaveBeenCalledOnce();
    expect(interrupted).toBe(true);
    expect(client.status).toBe('idle');
  });
});
