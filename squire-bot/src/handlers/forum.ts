/**
 * Forum Handler
 *
 * Watches forum channels for new posts and replies, forwarding to runner-agent.
 */

import {
  Events,
  ForumChannel,
  ThreadChannel,
  ChannelType,
  Message,
} from 'discord.js';
import type { Client } from 'discord.js';
import type { SquireBotWebSocketServer } from '../ws-server.js';
import type { SquireBotConfig, ForumConfig } from '../config.js';

export interface ForumPostCreatedEvent {
  type: 'forum_post_created';
  guildId: string;
  forumChannelId: string;
  postId: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  appliedTags: string[];
  timestamp: string;
}

export interface ForumPostRepliedEvent {
  type: 'forum_post_replied';
  guildId: string;
  forumChannelId: string;
  postId: string;
  replyId: string;
  content: string;
  authorId: string;
  authorName: string;
  timestamp: string;
}

export function setupForumHandler(
  client: Client,
  wsServer: SquireBotWebSocketServer,
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

    // Get the starter message
    let content = '';
    let authorId = 'unknown';
    let authorName = 'Unknown';

    try {
      const starterMessage = await thread.fetchStarterMessage();
      if (starterMessage) {
        content = starterMessage.content || '';
        authorId = starterMessage.author.id;
        authorName = starterMessage.author.username;
      }
    } catch (error) {
      console.error('[Forum] Could not fetch starter message:', error);
    }

    const event: ForumPostCreatedEvent = {
      type: 'forum_post_created',
      guildId: thread.guildId || '',
      forumChannelId: parent.id,
      postId: thread.id,
      title: thread.name,
      content,
      authorId,
      authorName,
      appliedTags: thread.appliedTags,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Forum] New post: ${thread.name}`);

    wsServer.broadcast('forum_post_created', event);
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

    const event: ForumPostRepliedEvent = {
      type: 'forum_post_replied',
      guildId: thread.guildId || '',
      forumChannelId: parent.id,
      postId: thread.id,
      replyId: message.id,
      content: message.content,
      authorId: message.author.id,
      authorName: message.author.username,
      timestamp: message.createdAt.toISOString(),
    };

    console.log(`[Forum] Reply in ${thread.name}: ${message.content.slice(0, 30)}...`);

    wsServer.broadcast('forum_post_replied', event);
  });

  console.log('[Forum] Handler initialized');
}
