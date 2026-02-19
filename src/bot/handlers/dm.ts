/**
 * DM Handler
 *
 * Handles direct messages to the bot using Squire core.
 * Supports text, images, and file attachments.
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

/**
 * Download an attachment and convert to base64
 */
async function downloadAttachment(url: string): Promise<{ data: string; mediaType: string }> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const base64 = Buffer.from(buffer).toString('base64');
  return { data: base64, mediaType: contentType };
}

/**
 * Check if attachment is an image
 */
function isImage(contentType: string): boolean {
  return contentType.startsWith('image/');
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
    const attachments = message.attachments;

    // Skip empty messages with no attachments
    if (!content && attachments.size === 0) return;

    const attachmentInfo = attachments.size > 0
      ? ` + ${attachments.size} attachment(s)`
      : '';
    console.log(`[DM] From ${message.author.username}: ${content.slice(0, 50)}...${attachmentInfo}`);

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
      // Handle images specially - download and pass to SDK
      const imageAttachments = attachments.filter(att => isImage(att.contentType || ''));
      const otherAttachments = attachments.filter(att => !isImage(att.contentType || ''));

      // Build message text with file info
      let messageText = content;
      if (otherAttachments.size > 0) {
        const fileList = otherAttachments.map(att =>
          `[Attachment: ${att.name} (${att.contentType || 'unknown'}, ${Math.round(att.size / 1024)}KB)]`
        ).join('\n');
        messageText = messageText ? `${messageText}\n\n${fileList}` : fileList;
      }

      // If we have images, use sendMessageWithImages
      if (imageAttachments.size > 0) {
        console.log(`[DM] Downloading ${imageAttachments.size} image(s)...`);
        const images = await Promise.all(
          imageAttachments.map(att => downloadAttachment(att.url))
        );
        await squire.sendMessageWithImages(workspaceId, messageText, images);
      } else if (messageText) {
        await squire.sendMessage(workspaceId, messageText);
      }
    } catch (error) {
      console.error('[DM] Error:', error);
      await message.reply('An error occurred processing your request.');
    }
  });

  console.log('[DM] Handler initialized');
}
