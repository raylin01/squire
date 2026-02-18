/**
 * DM Handler
 *
 * Handles direct messages to the bot using Squire core.
 */

import {
  Events,
  Message,
  ChannelType,
} from 'discord.js';
import type { Client } from 'discord.js';
import type { Squire } from '../../index.js';
import { registerQuestionChannel } from './questions.js';

interface WorkspaceManager {
  getOrCreateWorkspace(channelId: string, channelName: string, source: 'discord_dm' | 'discord_channel' | 'discord_forum'): Promise<string>;
}

interface DiscordCommunicator {
  registerChannel(workspaceId: string, channel: any): void;
}

export function setupDmHandler(
  client: Client,
  squire: Squire,
  workspaceManager: WorkspaceManager,
  communicator: DiscordCommunicator
): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only handle DMs
    if (message.channel.type !== ChannelType.DM) return;

    const content = message.content.trim();
    if (!content) return;

    console.log(`[DM] From ${message.author.username}: ${content.slice(0, 50)}...`);

    // Get or create workspace for this DM channel
    const workspaceId = await workspaceManager.getOrCreateWorkspace(
      message.channelId,
      `dm-${message.author.username}`,
      'discord_dm'
    );

    // Register channel for responses
    communicator.registerChannel(workspaceId, message.channel);
    // Also register for AskUserQuestion handling
    if (!message.channel.partial) {
      registerQuestionChannel(workspaceId, message.channel);
    }

    // Send to Squire
    try {
      await squire.sendMessage(workspaceId, content);
    } catch (error) {
      console.error('[DM] Error:', error);
      await message.reply('An error occurred processing your request.');
    }
  });

  console.log('[DM] Handler initialized');
}
