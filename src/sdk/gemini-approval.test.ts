import { describe, expect, it, vi } from 'vitest';

import { GeminiSDKClient } from './gemini.js';

function createClient(): GeminiSDKClient {
  return new GeminiSDKClient({
    provider: 'gemini',
    cwd: process.cwd(),
    permissionMode: 'strict',
    outputThrottleMs: 0,
  });
}

describe('GeminiSDKClient sendApproval', () => {
  it('does not pretend an allow succeeded when the CLI has no approval channel', async () => {
    const client = createClient();
    (client as any).client = { interrupt: vi.fn() };

    await expect(client.sendApproval('req-1', 'allow')).rejects.toThrow(
      /no approval response channel/
    );
    expect((client as any).approvalTracker.get('req-1')).toBeUndefined();
  });

  it('interrupts the turn when denying without an approval channel', async () => {
    const client = createClient();
    const interrupt = vi.fn(async () => undefined);
    (client as any).client = {
      interrupt,
      getCurrentTurn: () => ({ status: 'running' }),
    };

    await client.sendApproval('req-2', 'deny');

    expect(interrupt).toHaveBeenCalledOnce();
    expect(client.status).toBe('idle');
  });

  it('forwards allow to approveRequest when the client exposes it', async () => {
    const client = createClient();
    const approveRequest = vi.fn(async () => undefined);
    (client as any).client = { approveRequest };
    (client as any).approvalTracker.add('req-3', {
      requestId: 'req-3',
      toolName: 'Bash',
      input: { command: 'ls' },
      createdAt: Date.now(),
    });

    await client.sendApproval('req-3', 'allow');

    expect(approveRequest).toHaveBeenCalledWith('req-3', {
      updatedInput: { command: 'ls' },
      message: 'Approved',
    });
  });
});
