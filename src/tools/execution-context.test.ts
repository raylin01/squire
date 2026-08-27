import { describe, expect, it } from 'vitest';
import { getExecutionContext, runWithExecutionContext } from './registry.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('tool execution context', () => {
  it('isolates workspace ids across overlapping executions', async () => {
    const seen: string[] = [];

    await Promise.all([
      runWithExecutionContext({ workspaceId: 'ws-a' }, async () => {
        await delay(30);
        seen.push(`a:${getExecutionContext().workspaceId}`);
      }),
      runWithExecutionContext({ workspaceId: 'ws-b' }, async () => {
        await delay(10);
        seen.push(`b:${getExecutionContext().workspaceId}`);
      }),
    ]);

    expect(seen).toContain('a:ws-a');
    expect(seen).toContain('b:ws-b');
  });
});
