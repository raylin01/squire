import { describe, expect, it, vi } from 'vitest';

import { MessageQueue, OutputThrottler } from './base.js';

describe('OutputThrottler', () => {
  it('emits the first stdout chunk immediately', () => {
    const emit = vi.fn();
    const throttler = new OutputThrottler(emit, 5000);

    throttler.addStdout('Hello');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      content: 'Hello',
      isComplete: false,
      outputType: 'stdout',
    });
  });

  it('emits the first thinking chunk immediately', () => {
    const emit = vi.fn();
    const throttler = new OutputThrottler(emit, 5000);

    throttler.addThinking('thinking');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      content: 'thinking',
      isComplete: false,
      outputType: 'thinking',
    });
  });

  it('rejects queued messages when cleared with an error', async () => {
    let releaseFirstMessage: (() => void) | undefined;
    const sender = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstMessage = resolve;
      });
    });
    const queue = new MessageQueue(sender);

    const first = queue.enqueue({ role: 'user', content: 'first' });
    const second = queue.enqueue({ role: 'user', content: 'second' });

    await Promise.resolve();
    queue.clear(new Error('Interrupted'));
    releaseFirstMessage?.();

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow('Interrupted');
  });
});
