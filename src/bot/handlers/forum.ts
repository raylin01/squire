/**
 * Forum Handler
 *
 * Watches forum channels for new posts and replies, forwarding to Squire.
 */

import {
  Events,
  ThreadChannel,
  ChannelType,
  Message,
} from 'discord.js';
import type { Client } from 'discord.js';
import type { Squire } from '../../index.js';
import { evaluateDiscordAccess } from '../access-control.js';
import type { SquireBotConfig } from '../config.js';

interface WorkspaceManager {
  getOrCreateWorkspace(channelId: string, channelName: string, source: 'discord_dm' | 'discord_channel' | 'discord_forum'): Promise<string>;
}

interface DiscordCommunicator {
  registerChannel(workspaceId: string, channel: any): void;
}

export function setupForumHandler(
  client: Client,
  squire: Squire,
  workspaceManager: WorkspaceManager,
  communicator: DiscordCommunicator,
  config: SquireBotConfig
): void {
  // Track configured forums
  const configuredForums = new Set<string>();
  if (config.forums) {
    for (const forum of Object.values(config.forums)) {
      configuredForums.add(forum.channelId);
    }
  }

  // Handle new forum posts (threads)
  client.on(Events.ThreadCreate, async (thread: ThreadChannel, newlyCreated: boolean) => {
    if (!newlyCreated) return;

    // Check if this is in a forum channel
    const parent = thread.parent;
    if (!parent || parent.type !== ChannelType.GuildForum) return;

    // Only watch configured forums, or all if none configured
    if (configuredForums.size > 0 && !configuredForums.has(parent.id)) return;

    const access = evaluateDiscordAccess(config, {
      userId: thread.ownerId || '',
      guildId: thread.guildId,
    });
    if (!access.allowed) {
      console.warn(`[Access] Denied forum post from ${thread.ownerId}: ${access.reason}`);
      return;
    }

    // Get the starter message
    let content = '';

    try {
      const starterMessage = await thread.fetchStarterMessage();
      if (starterMessage) {
        content = starterMessage.content || '';
      }
    } catch (error) {
      console.error('[Forum] Could not fetch starter message:', error);
    }

    if (!content) return;

    console.log(`[Forum] New post: ${thread.name}`);

    // Create workspace for this thread
    const workspaceId = await workspaceManager.getOrCreateWorkspace(
      thread.id,
      thread.name,
      'discord_forum'
    );

    // Register thread for responses
    communicator.registerChannel(workspaceId, thread);

    // Send to Squire with context
    const contextMessage = `New forum post: "${thread.name}"\n\n${content}`;
    try {
      await squire.sendMessage(workspaceId, contextMessage);
    } catch (error) {
      console.error('[Forum] Error:', error);
    }
  });

  // Handle replies in forum posts
  client.on(Events.MessageCreate, async (message: Message) => {
    // Only handle messages in threads (forum posts)
    if (!message.channel.isThread()) return;
    if (message.author.bot) return;

    const thread = message.channel;
    const parent = thread.parent;
    if (!parent || parent.type !== ChannelType.GuildForum) return;

    // Only watch configured forums, or all if none configured
    if (configuredForums.size > 0 && !configuredForums.has(parent.id)) return;

    const access = evaluateDiscordAccess(config, {
      userId: message.author.id,
      guildId: message.guildId,
    });
    if (!access.allowed) {
      console.warn(`[Access] Denied forum reply from ${message.author.id}: ${access.reason}`);
      return;
    }

    const content = message.content.trim();
    if (!content) return;

    console.log(`[Forum] Reply in ${thread.name}: ${content.slice(0, 30)}...`);

    // Get existing workspace for this thread
    const workspaceId = await workspaceManager.getOrCreateWorkspace(
      thread.id,
      thread.name,
      'discord_forum'
    );

    // Register thread for responses
    communicator.registerChannel(workspaceId, thread);

    // Send to Squire
    try {
      await squire.sendMessage(workspaceId, content);
    } catch (error) {
      console.error('[Forum] Error:', error);
    }
  });

  console.log('[Forum] Handler initialized');
}
