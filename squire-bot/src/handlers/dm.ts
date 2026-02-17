/**
 * DM Handler
 *
 * Forwards DM messages to runner-agent via WebSocket.
 */

import {
  Events,
  Message,
  ChannelType,
} from 'discord.js';
import type { Client } from 'discord.js';
import type { SquireBotWebSocketServer } from '../ws-server.js';

export interface DmReceivedEvent {
  type: 'dm_received';
  userId: string;
  channelId: string;
  content: string;
  authorName: string;
  timestamp: string;
}

export function setupDmHandler(client: Client, wsServer: SquireBotWebSocketServer): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only handle DMs
    if (message.channel.type !== ChannelType.DM) return;

    const event: DmReceivedEvent = {
      type: 'dm_received',
      userId: message.author.id,
      channelId: message.channel.id,
      content: message.content,
      authorName: message.author.username,
      timestamp: message.createdAt.toISOString(),
    };

    console.log(`[DM] From ${message.author.username}: ${message.content.slice(0, 50)}...`);

    // Broadcast to all connected runners
    wsServer.broadcast('dm_received', event);
  });

  console.log('[DM] Handler initialized');
}
