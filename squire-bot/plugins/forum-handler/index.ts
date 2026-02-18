/**
 * Forum Handler Plugin
 *
 * Watches forum channels for new posts and replies, forwarding to Squire.
 * Converted from handlers/forum.ts to a plugin for better modularity.
 *
 * Configuration (in ~/.squirebot/config.json):
 * {
 *   "forums": {
 *     "myForum": {
 *       "guildId": "123456789",
 *       "channelId": "987654321"
 *     }
 *   }
 * }
 *
 * If no forums are configured, ALL forum channels will be watched.
 */

import type { SquirePlugin, PluginContext, WorkspaceSource } from '../../src/plugins/types.js';
import {
  Events,
  ThreadChannel,
  ChannelType,
  Message,
} from 'discord.js';
import { registerQuestionChannel } from '../../src/handlers/questions.js';

export default {
  name: 'forum-handler',
  version: '1.0.0',
  description: 'Watches forum channels and forwards posts/replies to Squire',
  author: 'Squire',

  async onLoad(context: PluginContext) {
    const forums = context.config.forums as Record<string, { channelId: string }> | undefined;
    if (forums && Object.keys(forums).length > 0) {
      context.log(`Watching ${Object.keys(forums).length} configured forum(s)`);
    } else {
      context.log('Watching ALL forum channels (no specific forums configured)');
    }
  },

  async setup(client, context) {
    // Track configured forums
    const configuredForums = new Set<string>();
    const forums = context.config.forums as Record<string, { channelId: string }> | undefined;
    if (forums) {
      for (const forum of Object.values(forums)) {
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

      // Get the starter message
      let content = '';

      try {
        const starterMessage = await thread.fetchStarterMessage();
        if (starterMessage) {
          content = starterMessage.content || '';
        }
      } catch (error) {
        context.error('Could not fetch starter message:', error);
      }

      if (!content) return;

      context.log(`New post: ${thread.name}`);

      // Create workspace for this thread
      const workspaceId = await context.getOrCreateWorkspace(
        thread.id,
        thread.name,
        'discord_forum'
      );

      // Register thread for responses
      context.registerChannel(workspaceId, thread);
      // Also register for AskUserQuestion handling
      registerQuestionChannel(workspaceId, thread);

      // Send to Squire with context
      const contextMessage = `New forum post: "${thread.name}"\n\n${content}`;
      try {
        await context.squire.sendMessage(workspaceId, contextMessage);
      } catch (error) {
        context.error('Error sending to Squire:', error);
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

      const content = message.content.trim();
      if (!content) return;

      context.log(`Reply in ${thread.name}: ${content.slice(0, 30)}...`);

      // Get existing workspace for this thread
      const workspaceId = await context.getOrCreateWorkspace(
        thread.id,
        thread.name,
        'discord_forum'
      );

      // Register thread for responses
      context.registerChannel(workspaceId, thread);
      // Also register for AskUserQuestion handling
      registerQuestionChannel(workspaceId, thread);

      // Send to Squire
      try {
        await context.squire.sendMessage(workspaceId, content);
      } catch (error) {
        context.error('Error sending to Squire:', error);
      }
    });

    context.log('Forum handler ready');
  },

  enabled: true,
  priority: 5, // Load early so it's ready before other plugins
} satisfies SquirePlugin;
