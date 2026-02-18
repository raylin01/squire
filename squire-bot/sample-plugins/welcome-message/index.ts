/**
 * Sample Plugin: Welcome Message
 *
 * A simple example plugin that sends a welcome message when a new member joins.
 * This demonstrates how Squire can write its own Discord.js plugins.
 *
 * To use:
 * 1. Copy this folder to ~/.squirebot/plugins/welcome-message/
 * 2. Restart squire-bot (or use hot reload)
 */

import type { SquirePlugin, PluginContext } from '../src/plugins/types.js';
import { Events, GuildMember, EmbedBuilder } from 'discord.js';

export default {
  name: 'welcome-message',
  version: '1.0.0',
  description: 'Sends a welcome message to new members',
  author: 'Squire',

  // Called when plugin is loaded
  onLoad: async (context: PluginContext) => {
    context.log('Welcome message plugin loaded');

    // Store welcome channel preference (can be set via command)
    const welcomeChannel = context.getState<string>('welcomeChannelId');
    if (!welcomeChannel) {
      context.log('No welcome channel set. Use !setwelcome to configure.');
    }
  },

  // Called when plugin is unloaded
  onUnload: async () => {
    console.log('[welcome-message] Plugin unloaded');
  },

  // Setup Discord.js event handlers
  setup: async (client, context) => {
    // Listen for new members
    client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
      context.log(`New member joined: ${member.user.tag}`);

      // Get welcome channel from state
      const welcomeChannelId = context.getState<string>('welcomeChannelId');
      if (!welcomeChannelId) {
        context.log('No welcome channel configured, skipping welcome message');
        return;
      }

      // Find the channel
      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (!channel || !channel.isTextBased()) {
        context.error(`Welcome channel ${welcomeChannelId} not found or not text-based`);
        return;
      }

      // Create welcome embed
      const embed = new EmbedBuilder()
        .setTitle(`Welcome to ${member.guild.name}!`)
        .setDescription(`Hey ${member}, welcome to our server!`)
        .setThumbnail(member.user.displayAvatarURL())
        .setColor(0x00ff00)
        .setTimestamp();

      // Send welcome message
      await channel.send({ embeds: [embed] });
      context.log(`Sent welcome message for ${member.user.tag}`);
    });

    // Listen for commands (simple !setwelcome implementation)
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      if (!message.content.startsWith('!setwelcome ')) return;

      // Check permissions
      if (!message.member?.permissions.has('Administrator')) {
        await message.reply('You need Administrator permission to set the welcome channel.');
        return;
      }

      // Store the channel ID
      context.setState('welcomeChannelId', message.channelId);
      await message.reply(`Welcome channel set to <#${message.channelId}>`);
      context.log(`Welcome channel set to ${message.channelId}`);
    });

    context.log('Event handlers registered');
  },

  // Plugin metadata
  enabled: true,
  priority: 10,
} satisfies SquirePlugin;
