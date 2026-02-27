import { describe, expect, it } from 'vitest';
import { ClaudeSDKClient } from './claude.js';

describe('ClaudeSDKClient approval forwarding', () => {
  it('falls back to tracked tool input when updatedInput is omitted', async () => {
    const client = new ClaudeSDKClient({
      provider: 'claude',
      cwd: process.cwd(),
      permissionMode: 'autoSafe',
    });

    const sentResponses: Array<Record<string, unknown>> = [];
    (client as any).client = {};
    (client as any).sendControlResponse = async (_requestId: string, responseData: Record<string, unknown>) => {
      sentResponses.push(responseData);
    };

    (client as any).approvalTracker.add('req-1', {
      requestId: 'req-1',
      toolName: 'mcp__playwright__browser_navigate',
      input: { url: 'https://example.com' },
      createdAt: Date.now(),
    });

    await client.sendApproval('req-1', 'allow');

    expect(sentResponses).toHaveLength(1);
    expect(sentResponses[0]).toMatchObject({
      behavior: 'allow',
      updatedInput: { url: 'https://example.com' },
    });
  });

  it('prefers explicit updatedInput when provided', async () => {
    const client = new ClaudeSDKClient({
      provider: 'claude',
      cwd: process.cwd(),
      permissionMode: 'autoSafe',
    });

    const sentResponses: Array<Record<string, unknown>> = [];
    (client as any).client = {};
    (client as any).sendControlResponse = async (_requestId: string, responseData: Record<string, unknown>) => {
      sentResponses.push(responseData);
    };

    (client as any).approvalTracker.add('req-2', {
      requestId: 'req-2',
      toolName: 'Bash',
      input: { command: 'ls -la' },
      createdAt: Date.now(),
    });

    await client.sendApproval('req-2', 'allow', { command: 'pwd' });

    expect(sentResponses).toHaveLength(1);
    expect(sentResponses[0]).toMatchObject({
      behavior: 'allow',
      updatedInput: { command: 'pwd' },
    });
  });
});
