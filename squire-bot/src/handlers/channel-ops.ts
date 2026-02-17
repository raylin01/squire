/**
 * Channel Operations Handler
 *
 * Handles channel management requests from runner-agent.
 */

import {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import type { Client, Guild, TextChannel, VoiceChannel, ForumChannel } from 'discord.js';
import type { SquireBotWebSocketServer, WebSocketMessage } from '../ws-server.js';

interface CreateChannelData {
  name: string;
  type: 'text' | 'voice' | 'forum';
  parentId?: string;
  topic?: string;
  guildId: string;
}

interface SendMessageData {
  channelId: string;
  content?: string;
  embed?: {
    title?: string;
    description?: string;
    color?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
}

interface RenameChannelData {
  channelId: string;
  newName: string;
  guildId: string;
}

interface SetTopicData {
  channelId: string;
  topic: string;
  guildId: string;
}

interface CreateForumPostData {
  forumChannelId: string;
  title: string;
  content: string;
  tags?: string[];
  guildId: string;
}

export function setupChannelOpsHandler(
  client: Client,
  wsServer: SquireBotWebSocketServer
): void {
  wsServer.on('create_channel', async (message: WebSocketMessage) => {
    const data = message.data as CreateChannelData;
    const guild = client.guilds.cache.get(data.guildId);

    if (!guild) {
      return { type: 'error', success: false, error: 'Guild not found' };
    }

    const channelType = data.type === 'voice' ? ChannelType.GuildVoice
      : data.type === 'forum' ? ChannelType.GuildForum
      : ChannelType.GuildText;

    const channel = await guild.channels.create({
      name: data.name,
      type: channelType,
      parent: data.parentId,
      topic: data.topic,
    });

    console.log(`[ChannelOps] Created channel: ${data.name} in ${guild.name}`);

    return {
      type: 'response',
      success: true,
      data: {
        channelId: channel.id,
        name: channel.name,
        type: data.type,
      },
    };
  });

  wsServer.on('send_message', async (message: WebSocketMessage) => {
    const data = message.data as SendMessageData;
    const channel = client.channels.cache.get(data.channelId);

    if (!channel || !channel.isTextBased()) {
      return { type: 'error', success: false, error: 'Channel not found or not text-based' };
    }

    const options: { content?: string; embeds?: EmbedBuilder[] } = {};

    if (data.content) {
      options.content = data.content;
    }

    if (data.embed) {
      const embed = new EmbedBuilder();
      if (data.embed.title) embed.setTitle(data.embed.title);
      if (data.embed.description) embed.setDescription(data.embed.description);
      if (data.embed.color) {
        const color = resolveColor(data.embed.color);
        embed.setColor(color);
      }
      if (data.embed.fields) {
        embed.addFields(data.embed.fields);
      }
      options.embeds = [embed];
    }

    const sentMessage = await (channel as TextChannel).send(options);

    console.log(`[ChannelOps] Sent message to ${channel.id}`);

    return {
      type: 'response',
      success: true,
      data: {
        messageId: sentMessage.id,
        channelId: channel.id,
      },
    };
  });

  wsServer.on('rename_channel', async (message: WebSocketMessage) => {
    const data = message.data as RenameChannelData;
    const guild = client.guilds.cache.get(data.guildId);

    if (!guild) {
      return { type: 'error', success: false, error: 'Guild not found' };
    }

    const channel = guild.channels.cache.get(data.channelId);
    if (!channel) {
      return { type: 'error', success: false, error: 'Channel not found' };
    }

    await channel.setName(data.newName);

    console.log(`[ChannelOps] Renamed channel to: ${data.newName}`);

    return {
      type: 'response',
      success: true,
      data: {
        channelId: channel.id,
        newName: channel.name,
      },
    };
  });

  wsServer.on('set_topic', async (message: WebSocketMessage) => {
    const data = message.data as SetTopicData;
    const guild = client.guilds.cache.get(data.guildId);

    if (!guild) {
      return { type: 'error', success: false, error: 'Guild not found' };
    }

    const channel = guild.channels.cache.get(data.channelId);
    if (!channel || !('setTopic' in channel)) {
      return { type: 'error', success: false, error: 'Channel not found or cannot have topic' };
    }

    await (channel as TextChannel).setTopic(data.topic);

    console.log(`[ChannelOps] Set topic on channel ${data.channelId}`);

    return {
      type: 'response',
      success: true,
      data: {
        channelId: channel.id,
      },
    };
  });

  wsServer.on('create_forum_post', async (message: WebSocketMessage) => {
    const data = message.data as CreateForumPostData;
    const channel = client.channels.cache.get(data.forumChannelId);

    if (!channel || channel.type !== ChannelType.GuildForum) {
      return { type: 'error', success: false, error: 'Forum channel not found' };
    }

    const forumChannel = channel as ForumChannel;

    const thread = await forumChannel.threads.create({
      name: data.title,
      message: {
        content: data.content,
      },
      appliedTags: data.tags,
    });

    console.log(`[ChannelOps] Created forum post: ${data.title}`);

    return {
      type: 'response',
      success: true,
      data: {
        postId: thread.id,
        forumChannelId: forumChannel.id,
      },
    };
  });

  console.log('[ChannelOps] Handler initialized');
}

function resolveColor(color: string): number {
  const colors: Record<string, number> = {
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    yellow: 0xffff00,
    orange: 0xff8800,
    purple: 0x8800ff,
    white: 0xffffff,
    black: 0x000000,
  };

  if (colors[color.toLowerCase()]) {
    return colors[color.toLowerCase()];
  }

  // Try parsing as hex
  if (color.startsWith('#')) {
    return parseInt(color.slice(1), 16);
  }

  if (color.startsWith('0x')) {
    return parseInt(color, 16);
  }

  return 0x000000; // Default to black
}
