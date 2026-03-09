import { describe, expect, it, vi } from 'vitest';

import { ClaudeSDKClient } from './claude.js';

function createClient(): ClaudeSDKClient {
  return new ClaudeSDKClient({
    provider: 'claude',
    cwd: process.cwd(),
    permissionMode: 'strict',
    outputThrottleMs: 0,
  });
}

function createSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'turn-1',
    input: 'hello',
    status: 'running',
    currentOutputKind: 'idle',
    currentMessage: {
      type: 'idle',
      content: '',
    },
    text: '',
    thinking: '',
    toolUses: [],
    toolResults: [],
    openRequests: [],
    history: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ClaudeSDKClient structured migration', () => {
  it('falls back to tracked tool input when updatedInput is omitted', async () => {
    const client = createClient();
    const approveRequest = vi.fn(async () => undefined);

    (client as any).client = {
      approveRequest,
    };

    (client as any).approvalTracker.add('req-1', {
      requestId: 'req-1',
      toolName: 'mcp__playwright__browser_navigate',
      input: { url: 'https://example.com' },
      createdAt: Date.now(),
      requestKind: 'tool_approval',
      request: {
        id: 'req-1',
        kind: 'tool_approval',
        status: 'open',
        createdAt: new Date().toISOString(),
        turnId: 'turn-1',
        toolName: 'mcp__playwright__browser_navigate',
        toolUseId: 'tool-1',
        input: { url: 'https://example.com' },
        suggestions: [],
      },
    });

    await client.sendApproval('req-1', 'allow');

    expect(approveRequest).toHaveBeenCalledWith('req-1', {
      updatedInput: { url: 'https://example.com' },
      message: 'Approved',
    });
  });

  it('answers question requests using normalized answer input', async () => {
    const client = createClient();
    const answerQuestion = vi.fn(async () => undefined);

    (client as any).client = {
      answerQuestion,
    };

    (client as any).approvalTracker.add('req-q', {
      requestId: 'req-q',
      toolName: 'AskUserQuestion',
      input: { question: 'Pick one' },
      createdAt: Date.now(),
      requestKind: 'question',
      request: {
        id: 'req-q',
        kind: 'question',
        status: 'open',
        createdAt: new Date().toISOString(),
        turnId: 'turn-1',
        title: 'Pick one',
        prompt: 'Pick one',
        questions: [
          {
            id: 'question-1',
            prompt: 'Pick one',
            options: [
              { label: 'alpha', value: 'alpha' },
              { label: 'beta', value: 'beta' },
            ],
            multiSelect: false,
          },
        ],
        allowOther: true,
        multiSelect: false,
        currentQuestionIndex: 0,
      },
    });

    await client.sendApproval('req-q', 'allow', {
      answers: {
        answer: 'beta',
      },
    });

    expect(answerQuestion).toHaveBeenCalledWith('req-q', 'beta');
  });

  it('emits AskUserQuestion requests in the legacy Squire shape', async () => {
    const client = createClient();
    const approvals: Array<Record<string, unknown>> = [];
    client.on('approval', (event) => approvals.push(event as unknown as Record<string, unknown>));

    await (client as any).handleTurnUpdate({
      kind: 'request_opened',
      turnId: 'turn-1',
      snapshot: createSnapshot({
        status: 'waiting',
        currentOutputKind: 'question',
        currentMessage: {
          type: 'question',
          content: 'Choose an option',
          requestId: 'req-q',
        },
        openRequests: [
          {
            id: 'req-q',
            kind: 'question',
            status: 'open',
            createdAt: new Date().toISOString(),
            turnId: 'turn-1',
            title: 'Choose an option',
            prompt: 'Choose an option',
            questions: [
              {
                id: 'question-1',
                header: 'Primary',
                prompt: 'Choose an option',
                options: [
                  { label: 'alpha', value: 'alpha', description: 'First' },
                  { label: 'beta', value: 'beta', description: 'Second' },
                ],
                multiSelect: false,
              },
            ],
            allowOther: true,
            multiSelect: false,
            currentQuestionIndex: 0,
          },
        ],
        history: [
          {
            kind: 'request_opened',
            timestamp: new Date().toISOString(),
            request: {
              id: 'req-q',
              kind: 'question',
              status: 'open',
              createdAt: new Date().toISOString(),
              turnId: 'turn-1',
              title: 'Choose an option',
              prompt: 'Choose an option',
              questions: [
                {
                  id: 'question-1',
                  header: 'Primary',
                  prompt: 'Choose an option',
                  options: [
                    { label: 'alpha', value: 'alpha', description: 'First' },
                    { label: 'beta', value: 'beta', description: 'Second' },
                  ],
                  multiSelect: false,
                },
              ],
              allowOther: true,
              multiSelect: false,
              currentQuestionIndex: 0,
            },
          },
        ],
      }),
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      requestId: 'req-q',
      toolName: 'AskUserQuestion',
      toolInput: {
        question: 'Choose an option',
        multiSelect: false,
        hasOther: true,
      },
    });
    expect((approvals[0].toolInput as { options: Array<{ label: string }> }).options.map((option) => option.label)).toEqual(['alpha', 'beta']);
  });

  it('flushes stdout before thinking and tool boundaries', async () => {
    const client = createClient();
    const outputs: Array<{ outputType: string; content: string }> = [];
    const toolUses: Array<{ toolName: string; toolId: string }> = [];

    client.on('output', (event) => {
      outputs.push({ outputType: event.outputType, content: event.content });
    });
    client.on('tool_use', (event) => {
      toolUses.push({ toolName: event.toolName, toolId: event.toolId });
    });

    await (client as any).handleTurnUpdate({
      kind: 'output',
      turnId: 'turn-1',
      snapshot: createSnapshot({
        currentOutputKind: 'text',
        currentMessage: { type: 'text', content: 'Hello there' },
        text: 'Hello there',
      }),
    });

    await (client as any).handleTurnUpdate({
      kind: 'output',
      turnId: 'turn-1',
      snapshot: createSnapshot({
        currentOutputKind: 'thinking',
        currentMessage: { type: 'thinking', content: 'thinking...' },
        text: 'Hello there',
        thinking: 'thinking...',
      }),
    });

    await (client as any).handleTurnUpdate({
      kind: 'tool_use',
      turnId: 'turn-1',
      snapshot: createSnapshot({
        currentOutputKind: 'tool_use',
        currentMessage: { type: 'tool_use', content: 'Bash', toolUseId: 'tool-1' },
        history: [
          {
            kind: 'tool_use',
            timestamp: new Date().toISOString(),
            toolUse: {
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'pwd' },
              startedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    });

    expect(outputs).toEqual([
      { outputType: 'stdout', content: 'Hello there' },
      { outputType: 'thinking', content: 'thinking...' },
    ]);
    expect(toolUses).toEqual([{ toolName: 'Bash', toolId: 'tool-1' }]);
  });
});
