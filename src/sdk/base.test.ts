import { describe, expect, it, vi } from 'vitest';

import { OutputThrottler } from './base.js';

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
});