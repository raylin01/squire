import { describe, expect, it } from 'vitest';
import { DiscordCommunicator } from './discord-communicator.js';
import { DiscordOutputRouter } from './output-router.js';

class FakeMessage {
  public edits: string[] = [];
  public content: string;

  constructor(content: string) {
    this.content = content;
  }

  async edit(nextContent: string): Promise<FakeMessage> {
    this.content = nextContent;
    this.edits.push(nextContent);
    return this;
  }
}

class FakeChannel {
  public sends: string[] = [];
  public typingCount = 0;
  public messages: FakeMessage[] = [];

  async send(payload: string | { content?: string }): Promise<FakeMessage> {
    const content = typeof payload === 'string' ? payload : (payload.content || '');
    this.sends.push(content);
    const msg = new FakeMessage(content);
    this.messages.push(msg);
    return msg;
  }

  async sendTyping(): Promise<void> {
    this.typingCount += 1;
  }

  isTextBased(): boolean {
    return true;
  }
}

class DelayedFakeChannel extends FakeChannel {
  private resolver: ((msg: FakeMessage) => void) | null = null;
  private pendingContent: string | null = null;

  async send(payload: string | { content?: string }): Promise<FakeMessage> {
    const content = typeof payload === 'string' ? payload : (payload.content || '');
    this.pendingContent = content;
    return new Promise<FakeMessage>((resolve) => {
      this.resolver = resolve;
    });
  }

  resolveSend(): void {
    if (!this.resolver || this.pendingContent === null) return;
    const msg = new FakeMessage(this.pendingContent);
    this.sends.push(this.pendingContent);
    this.messages.push(msg);
    const resolve = this.resolver;
    this.resolver = null;
    this.pendingContent = null;
    resolve(msg);
  }
}

function createCommunicator(channel: FakeChannel): DiscordCommunicator {
  const fakeClient = {
    channels: {
      fetch: async () => channel,
    },
  };

  const communicator = new DiscordCommunicator(fakeClient as any);
  communicator.registerChannel('ws-1', channel as any);
  return communicator;
}

describe('Discord streaming integration', () => {
  it('edits a streaming message and finalizes without posting a duplicate', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);

    await communicator.sendText('ws-1', 'Hello', false);
    await communicator.sendText('ws-1', 'Hello world', false);
    await communicator.sendText('ws-1', 'Hello world!', true);

    expect(channel.sends).toEqual(['Hello']);
    expect(channel.messages[0]?.edits).toEqual(['Hello world', 'Hello world!']);
    expect(communicator.hasStreamingMessage('ws-1')).toBe(false);
  });

  it('splits long complete messages into Discord-sized chunks', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const content = 'a'.repeat(4500);

    await communicator.sendText('ws-1', content, true);

    expect(channel.sends.length).toBe(3);
    expect(channel.sends.join('')).toBe(content);
  });

  it('routes stdout only, strips squire-tool content, and starts a new message after type change', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Start',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Start\n```squire-tool\ntool_name: x',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'internal thinking',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Next response\n```squire-tool\ntool_name: y\ndescription: internal\n```',
      isComplete: false,
    });

    expect(channel.sends).toEqual(['Start', 'Next response']);
    expect(channel.sends.join('\n')).not.toContain('squire-tool');
  });

  it('breaks stream on tool use so post-tool stdout starts a new Discord message', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Before tool',
      isComplete: false,
    });

    router.handleToolUse('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'After tool',
      isComplete: false,
    });

    expect(channel.sends).toEqual(['Before tool', 'After tool']);
  });

  it('emits three Discord messages for stdout -> thinking -> stdout -> tool_use -> stdout', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message A',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'thinking...',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message B',
      isComplete: false,
    });

    router.handleToolUse('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message C',
      isComplete: false,
    });

    expect(channel.sends).toEqual(['Message A', 'Message B', 'Message C']);
  });

  it('avoids duplicated final message when post-thinking stdout is accumulated', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Phase one',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'thinking',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Phase one + phase two',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'more thinking',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Phase one + phase two + phase three',
      isComplete: true,
    });

    expect(channel.sends).toEqual(['Phase one', '+ phase two', '+ phase three']);
  });

  it('keeps streaming message open across terminal thinking and complete-before-final-stdout ordering', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    router.resetWorkspace('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Alpha',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'thinking',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Alpha Beta',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'thinking-final',
      isComplete: true,
    });

    // Simulate complete arriving before a delayed stdout complete callback.
    router.handleComplete('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Alpha Beta Gamma',
      isComplete: true,
    });

    expect(channel.sends).toEqual(['Alpha', 'Beta']);
    expect(channel.messages[1]?.content).toBe('Beta Gamma');
  });

  it('uses prefix-overlap continuation when accumulated stdout slightly rewrites earlier text', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    router.resetWorkspace('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message 2: After using the tool, here is my second message!',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'thinking',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message 2: After using the tool, here is my second message!\nMessage 3: Final.',
      isComplete: true,
    });

    expect(channel.sends).toEqual([
      'Message 2: After using the tool, here is my second message!',
      'Message 3: Final.',
    ]);
  });

  it('avoids stale in-flight stream state after clearStreamingState race', async () => {
    const channel = new DelayedFakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    const firstSend = communicator.sendText('ws-1', 'transient', false);
    router.handleToolUse('ws-1');
    channel.resolveSend();
    await firstSend;

    const secondSend = router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'final message',
      isComplete: false,
    });
    channel.resolveSend();
    await secondSend;

    expect(channel.sends).toEqual(['transient', 'final message']);
  });

  it('trims continuation fragments to next structured section header', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    router.resetWorkspace('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message 2 content before',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'thinking',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: 'Message 2 content before responding!\n\n**Message 3:**\n\nFinal block',
      isComplete: true,
    });

    expect(channel.sends).toEqual([
      'Message 2 content before',
      '**Message 3:**\n\nFinal block',
    ]);
  });

  it('keeps prefix-stripped continuation stable across later stdout updates and final completion', async () => {
    const channel = new FakeChannel();
    const communicator = createCommunicator(channel);
    const router = new DiscordOutputRouter(communicator);

    router.resetWorkspace('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: '**Message 2:** Start of message 2.',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'internal',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: '**Message 2:** Start of message 2. More details.\n\n**Message 3:** First pass',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: '**Message 2:** Start of message 2. More details.\n\n**Message 3:** First pass with extension',
      isComplete: false,
    });

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'thinking',
      content: 'terminal snapshot',
      isComplete: true,
    });

    router.handleComplete('ws-1');

    await router.handleOutput({
      workspaceId: 'ws-1',
      outputType: 'stdout',
      content: '**Message 2:** Start of message 2. More details.\n\n**Message 3:** First pass with extension and final tail',
      isComplete: true,
    });

    expect(channel.sends.length).toBe(2);
    expect(channel.sends[0]).toBe('**Message 2:** Start of message 2.');
    const finalSecond = channel.messages[1]?.content || '';
    expect(finalSecond).toContain('**Message 3:**');
    expect(finalSecond).toContain('and final tail');
    expect((finalSecond.match(/\*\*Message 2:\*\*/g) || []).length).toBeLessThanOrEqual(1);
  });
});
