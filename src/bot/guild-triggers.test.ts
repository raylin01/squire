import { describe, expect, it } from 'vitest';
import { shouldHandleGuildMessage } from './guild-triggers.js';

describe('shouldHandleGuildMessage', () => {
  it('ignores ordinary channel chatter', () => {
    expect(shouldHandleGuildMessage({
      content: 'hello everyone',
      botUserId: 'bot-1',
      mentionedBot: false,
    })).toBe(false);
  });

  it('handles bang commands without a mention', () => {
    expect(shouldHandleGuildMessage({
      content: '!help',
      botUserId: 'bot-1',
      mentionedBot: false,
    })).toBe(true);
  });

  it('handles bot mentions', () => {
    expect(shouldHandleGuildMessage({
      content: '<@bot-1> status',
      botUserId: 'bot-1',
      mentionedBot: false,
    })).toBe(true);
    expect(shouldHandleGuildMessage({
      content: 'hey',
      botUserId: 'bot-1',
      mentionedBot: true,
    })).toBe(true);
  });
});
