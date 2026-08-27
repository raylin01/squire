import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from './workspace-session.js';

describe('WorkspaceSession interrupt', () => {
  it('clears the CLI session id so the next start does not resume', async () => {
    const session = new WorkspaceSession(
      {
        workspaceId: 'ws-1',
        name: 'test',
        source: 'discord_dm',
        sourceId: 'ch-1',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        status: 'active',
        context: { cliSessionId: 'cli-session-123' },
      } as any,
      { provider: 'claude', permissionMode: 'autoSafe' }
    );

    (session as any).sdkClient = {
      interrupt: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    };

    await session.interrupt();

    expect(session.getWorkspace().context?.cliSessionId).toBeUndefined();
    expect(session.isRunning()).toBe(false);
  });
});
