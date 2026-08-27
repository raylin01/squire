import { EventEmitter } from 'events';
import { ChannelType, Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_DENIED_MESSAGE } from '../access-control.js';
import { setupDmHandler } from './dm.js';

function createClient(): EventEmitter {
  return new EventEmitter();
}

function createDmMessage(options: {
  userId: string;
  content: string;
  username?: string;
}) {
  const replies: string[] = [];
  const channelSends: string[] = [];
  const message = {
    author: {
      bot: false,
      id: options.userId,
      username: options.username || 'ray',
    },
    channel: {
      type: ChannelType.DM,
      partial: false,
      isTextBased: () => true,
      send: vi.fn(async (content: string) => {
        channelSends.push(content);
      }),
    },
    channelId: 'dm-channel-1',
    guildId: null,
    content: options.content,
    attachments: {
      size: 0,
      filter: () => ({ size: 0, map: () => [] }),
    },
    reply: vi.fn(async (content: string) => {
      replies.push(content);
    }),
  };
  return { message, replies, channelSends };
}

describe('DM handler', () => {
  it('denies DMs from users outside allowedUsers', async () => {
    const client = createClient();
    const sendMessage = vi.fn();
    setupDmHandler(
      client as any,
      { sendMessage } as any,
      { getOrCreateWorkspace: vi.fn() } as any,
      { registerChannel: vi.fn() } as any,
      { allowedUsers: ['allowed-user'] }
    );

    const { message, replies } = createDmMessage({
      userId: 'stranger',
      content: 'hello',
    });
    await client.emit(Events.MessageCreate, message as any);
    await vi.waitFor(() => expect(replies.length).toBeGreaterThan(0));

    expect(replies[0]).toBe(ACCESS_DENIED_MESSAGE);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('runs !status for an allowed user without sending to the model', async () => {
    const client = createClient();
    const sendMessage = vi.fn();
    const getOrCreateWorkspace = vi.fn(async () => 'ws-dm-1');
    const registerChannel = vi.fn();
    setupDmHandler(
      client as any,
      {
        sendMessage,
        getStatus: () => ({ running: true, activity: 'ready', sdk: 'claude' }),
        getConfig: () => ({ name: 'Squire Dev', memory: { enabled: true } }),
      } as any,
      { getOrCreateWorkspace } as any,
      { registerChannel } as any,
      { allowedUsers: ['allowed-user'] }
    );

    const { message, replies } = createDmMessage({
      userId: 'allowed-user',
      content: '!status',
    });
    await client.emit(Events.MessageCreate, message as any);
    await vi.waitFor(() => expect(replies.length).toBeGreaterThan(0));

    expect(replies[0]).toContain('Squire Dev');
    expect(replies[0]).toContain('Running: Yes');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getOrCreateWorkspace).toHaveBeenCalledWith('dm-channel-1', 'dm-ray', 'discord_dm');
    expect(registerChannel).toHaveBeenCalled();
  });

  it('forwards a normal DM to Squire for an allowed user', async () => {
    const client = createClient();
    const sendMessage = vi.fn(async () => undefined);
    setupDmHandler(
      client as any,
      { sendMessage } as any,
      { getOrCreateWorkspace: vi.fn(async () => 'ws-dm-1') } as any,
      { registerChannel: vi.fn() } as any,
      { allowedUsers: ['allowed-user'] }
    );

    const { message } = createDmMessage({
      userId: 'allowed-user',
      content: 'hello squire',
    });
    await client.emit(Events.MessageCreate, message as any);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    expect(sendMessage).toHaveBeenCalledWith('ws-dm-1', 'hello squire');
  });
});
