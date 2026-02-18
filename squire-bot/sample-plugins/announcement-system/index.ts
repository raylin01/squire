/**
 * Sample Plugin: Announcement System
 *
 * A more advanced example showing:
 * - Slash command registration
 * - Role management
 * - Persistent state
 * - Error handling
 *
 * This is the kind of plugin Squire can autonomously create when a user
 * asks for a new Discord feature.
 */

import type { SquirePlugin, PluginContext } from '../src/plugins/types.js';
import {
  Events,
  SlashCommandBuilder,
  GuildMember,
  Role,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import type { Client } from 'discord.js';

// Plugin configuration
const SUBSCRIBER_ROLE_NAME = 'Announcement Subscriber';
const ANNOUNCEMENTS_CHANNEL_NAME = 'announcements';

export default {
  name: 'announcement-system',
  version: '1.0.0',
  description: 'Announcement system with subscriptions and @mention support',
  author: 'Squire',

  async onLoad(context: PluginContext) {
    context.log('Announcement system loaded');
    context.log('Use !announce <message> to post announcements');
    context.log('Use !subscribe to get announcement pings');
  },

  async onUnload() {
    console.log('[announcement-system] Plugin unloaded');
  },

  async setup(client: Client, context: PluginContext) {
    // Ensure subscriber role and channel exist in each guild
    client.on(Events.GuildCreate, async (guild) => {
      await ensureGuildSetup(guild, context);
    });

    // Setup existing guilds on load
    for (const guild of client.guilds.cache.values()) {
      await ensureGuildSetup(guild, context);
    }

    // Handle announcement commands
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      // !announce command
      if (message.content.startsWith('!announce ')) {
        await handleAnnounce(message, context);
        return;
      }

      // !subscribe command
      if (message.content.trim() === '!subscribe') {
        await handleSubscribe(message, context);
        return;
      }

      // !unsubscribe command
      if (message.content.trim() === '!unsubscribe') {
        await handleUnsubscribe(message, context);
        return;
      }
    });

    context.log('Announcement system ready');
  },

  enabled: true,
  priority: 20, // Load after welcome-message
} satisfies SquirePlugin;

/**
 * Ensure guild has required role and channel
 */
async function ensureGuildSetup(guild: any, context: PluginContext): Promise<void> {
  try {
    // Find or create subscriber role
    let subscriberRole = guild.roles.cache.find(
      (r: Role) => r.name === SUBSCRIBER_ROLE_NAME
    );

    if (!subscriberRole) {
      subscriberRole = await guild.roles.create({
        name: SUBSCRIBER_ROLE_NAME,
        color: 'Blue',
        mentionable: true,
        reason: 'Created by Squire Announcement System',
      });
      context.log(`Created role ${SUBSCRIBER_ROLE_NAME} in ${guild.name}`);
    }

    // Find announcements channel
    const announcementsChannel = guild.channels.cache.find(
      (c: any) => c.name === ANNOUNCEMENTS_CHANNEL_NAME && c.isTextBased()
    );

    if (!announcementsChannel) {
      context.log(`Note: No #${ANNOUNCEMENTS_CHANNEL_NAME} channel in ${guild.name}`);
    }
  } catch (error) {
    context.error(`Failed to setup guild ${guild.name}:`, error);
  }
}

/**
 * Handle !announce command
 */
async function handleAnnounce(message: any, context: PluginContext): Promise<void> {
  // Check permissions
  if (!message.member?.permissions.has('Administrator')) {
    await message.reply('You need Administrator permission to make announcements.');
    return;
  }

  const content = message.content.slice('!announce '.length).trim();
  if (!content) {
    await message.reply('Usage: !announce <message>');
    return;
  }

  const guild = message.guild;

  // Find subscriber role
  const subscriberRole = guild.roles.cache.find(
    (r: Role) => r.name === SUBSCRIBER_ROLE_NAME
  );

  // Find announcements channel or use current
  let targetChannel = guild.channels.cache.find(
    (c: any) => c.name === ANNOUNCEMENTS_CHANNEL_NAME && c.isTextBased()
  );

  if (!targetChannel) {
    targetChannel = message.channel;
  }

  // Create announcement embed
  const embed = new EmbedBuilder()
    .setTitle('Announcement')
    .setDescription(content)
    .setColor(0x5865f2)
    .setFooter({ text: `Announced by ${message.author.tag}` })
    .setTimestamp();

  // Send with role ping
  const content_with_ping = subscriberRole ? `<@&${subscriberRole.id}>` : '';

  try {
    await targetChannel.send({
      content: content_with_ping,
      embeds: [embed],
    });

    await message.reply(`Announcement posted to <#${targetChannel.id}>`);
    context.log(`Announcement posted by ${message.author.tag} in ${guild.name}`);
  } catch (error) {
    context.error('Failed to post announcement:', error);
    await message.reply('Failed to post announcement. Check my permissions.');
  }
}

/**
 * Handle !subscribe command
 */
async function handleSubscribe(message: any, context: PluginContext): Promise<void> {
  const guild = message.guild;
  const member = message.member as GuildMember;

  // Find subscriber role
  const subscriberRole = guild.roles.cache.find(
    (r: Role) => r.name === SUBSCRIBER_ROLE_NAME
  );

  if (!subscriberRole) {
    await message.reply('Announcement system not set up. Contact an administrator.');
    return;
  }

  // Check if already subscribed
  if (member.roles.cache.has(subscriberRole.id)) {
    await message.reply('You are already subscribed to announcements!');
    return;
  }

  // Add role
  try {
    await member.roles.add(subscriberRole);
    await message.reply('You are now subscribed to announcements!');
    context.log(`${member.user.tag} subscribed to announcements in ${guild.name}`);
  } catch (error) {
    context.error('Failed to add subscriber role:', error);
    await message.reply('Failed to subscribe. Check my permissions.');
  }
}

/**
 * Handle !unsubscribe command
 */
async function handleUnsubscribe(message: any, context: PluginContext): Promise<void> {
  const guild = message.guild;
  const member = message.member as GuildMember;

  // Find subscriber role
  const subscriberRole = guild.roles.cache.find(
    (r: Role) => r.name === SUBSCRIBER_ROLE_NAME
  );

  if (!subscriberRole) {
    await message.reply('Announcement system not set up. Contact an administrator.');
    return;
  }

  // Check if not subscribed
  if (!member.roles.cache.has(subscriberRole.id)) {
    await message.reply('You are not subscribed to announcements.');
    return;
  }

  // Remove role
  try {
    await member.roles.remove(subscriberRole);
    await message.reply('You are now unsubscribed from announcements.');
    context.log(`${member.user.tag} unsubscribed from announcements in ${guild.name}`);
  } catch (error) {
    context.error('Failed to remove subscriber role:', error);
    await message.reply('Failed to unsubscribe. Check my permissions.');
  }
}
