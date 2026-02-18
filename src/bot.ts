#!/usr/bin/env node
/**
 * SquireBot - Discord bot for Squire
 *
 * Standalone Discord bot that uses Squire core directly.
 * No runner-agent required - this IS the main interface.
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  EmbedBuilder,
  ChannelType,
  Message,
  TextChannel,
  DMChannel,
  ThreadChannel,
} from 'discord.js';
import { Squire, createSquire } from './index.js';
import type { WorkspaceSource } from './index.js';
import { loadConfig, saveConfig, createDefaultConfig, getConfigPath, getSquireBotDir } from './bot/config.js';
import type { SquireBotConfig } from './bot/config.js';
import { setupDmHandler } from './bot/handlers/dm.js';
import { handleCommand, setupCommandHandler } from './bot/handlers/commands.js';
import {
  handleAskUserQuestion,
  setupQuestionHandlers,
  registerQuestionChannel,
} from './bot/handlers/questions.js';
import {
  registerSlashCommands,
  setupSlashCommandHandler,
} from './bot/handlers/slash-commands.js';
import { PluginLoader, createPluginLoader } from './bot/plugins/index.js';
import type { PluginInfo } from './bot/plugins/index.js';
import path from 'path';

/**
 * Manages the mapping between Discord channels and Squire workspaces
 */
class WorkspaceManager {
  private squire: Squire;
  private workspaces = new Map<string, string>(); // channelId -> workspaceId

  constructor(squire: Squire) {
    this.squire = squire;
  }

  /**
   * Get or create a workspace for a Discord channel
   */
  async getOrCreateWorkspace(channelId: string, channelName: string, source: 'discord_dm' | 'discord_channel' | 'discord_forum'): Promise<string> {
    let workspaceId = this.workspaces.get(channelId);

    if (!workspaceId) {
      const workspace = await this.squire.createWorkspace({
        name: channelName,
        source,
        sourceId: channelId,
      });
      workspaceId = workspace.workspaceId;
      this.workspaces.set(channelId, workspaceId);
      console.log(`[Workspace] Created ${workspaceId} for ${source}:${channelName}`);
    }

    return workspaceId;
  }

  /**
   * Get workspace ID for a channel
   */
  getWorkspace(channelId: string): string | undefined {
    return this.workspaces.get(channelId);
  }
}

/**
 * Discord message sender for Squire communication
 */
class DiscordCommunicator {
  private client: Client;
  private channelMap = new Map<string, TextChannel | DMChannel | ThreadChannel>(); // workspaceId -> channel

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Register a channel for a workspace
   */
  registerChannel(workspaceId: string, channel: TextChannel | DMChannel | ThreadChannel): void {
    this.channelMap.set(workspaceId, channel);
  }

  /**
   * Send a text message to the workspace's Discord channel
   */
  async sendText(workspaceId: string, content: string): Promise<void> {
    const channel = this.channelMap.get(workspaceId);
    if (!channel) {
      console.warn(`[Communicator] No channel for workspace ${workspaceId}`);
      return;
    }

    // Split long messages
    const chunks = this.splitMessage(content, 2000);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  /**
   * Send an embed to the workspace's Discord channel
   */
  async sendEmbed(
    workspaceId: string,
    title: string,
    description: string,
    color: 'green' | 'red' | 'blue' | 'yellow' | 'orange' | 'purple' = 'blue'
  ): Promise<void> {
    const channel = this.channelMap.get(workspaceId);
    if (!channel) {
      console.warn(`[Communicator] No channel for workspace ${workspaceId}`);
      return;
    }

    const colorMap = {
      green: 0x00ff00,
      red: 0xff0000,
      blue: 0x0088ff,
      yellow: 0xffcc00,
      orange: 0xff8800,
      purple: 0x9900ff,
    };

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description.slice(0, 4096)) // Discord embed description limit
      .setColor(colorMap[color])
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  /**
   * Split a message into chunks that fit Discord's limits
   */
  private splitMessage(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      // Try to break at newline or space
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint < 0) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint < 0) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }

    return chunks;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  const safeMode = args.includes('--safe') || args.includes('--safe-mode');

  // Handle init command
  if (args[0] === 'init') {
    const token = args.find(a => a.startsWith('--token='))?.split('=')[1];
    const appId = args.find(a => a.startsWith('--app-id='))?.split('=')[1];
    const squireProvider = args.find(a => a.startsWith('--provider='))?.split('=')[1] as
      | 'claude'
      | 'gemini'
      | 'codex'
      | undefined;

    if (!token || !appId) {
      console.error('Usage: squire-bot init --token=YOUR_DISCORD_BOT_TOKEN --app-id=YOUR_APP_ID [--provider=claude|gemini|codex]');
      process.exit(1);
    }

    const config = createDefaultConfig(token, appId);
    if (squireProvider) {
      config.squire = { provider: squireProvider };
    }

    saveConfig(config);
    console.log(`[SquireBot] Config created at ${getConfigPath()}`);
    console.log(`[SquireBot] Provider: ${config.squire?.provider || 'claude'}`);
    process.exit(0);
  }

  // Load config
  let config = loadConfig();

  if (!config) {
    console.error('[SquireBot] No config found. Run `squire-bot init` first.');
    console.error(`Expected config at: ${getConfigPath()}`);
    process.exit(1);
  }

  // Allow env overrides
  if (process.env.DISCORD_TOKEN) {
    config = { ...config, discordToken: process.env.DISCORD_TOKEN };
  }
  if (process.env.DISCORD_APP_ID) {
    config = { ...config, discordAppId: process.env.DISCORD_APP_ID };
  }

  // Determine safe mode (CLI flag overrides config)
  const useSafeMode = safeMode || config.plugins?.safeMode || false;

  if (useSafeMode) {
    console.log('[SquireBot] Starting in SAFE MODE - all plugins disabled');
  }

  console.log('[SquireBot] Starting standalone Squire Discord bot...');

  // Create Discord client
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  // Create Squire instance
  const squireConfig = {
    squireId: `squire-${Date.now()}`,
    name: 'Squire',
    sdk: {
      provider: (config.squire?.provider || 'claude') as 'claude' | 'gemini' | 'codex',
    },
    permissions: {
      mode: 'autoSafe' as const,
      allowedTools: [],
      blockedTools: [],
    },
    memory: {
      enabled: true,
      provider: 'qmd' as const,
      retentionDays: 90,
    },
  };

  const squire = createSquire(squireConfig);
  const workspaceManager = new WorkspaceManager(squire);
  const communicator = new DiscordCommunicator(client);

  // Handle Squire communication events
  squire.on('communication', async (event: any) => {
    const data = event.data;
    // Find which workspace this came from
    const workspaceId = data.workspaceId as string | undefined;
    if (!workspaceId) return;

    if (data.type === 'text') {
      await communicator.sendText(workspaceId, data.content as string);
    } else if (data.type === 'embed') {
      await communicator.sendEmbed(
        workspaceId,
        (data.title as string) || 'Update',
        data.content as string,
        (data.color as 'green' | 'red' | 'blue') || 'blue'
      );
    }
  });

  // Handle status updates (typing indicator, activity)
  squire.on('status', (event: any) => {
    const data = event.data;
    console.log(`[Squire] Status: ${data.activity}`);
  });

  // Handle approval requests
  squire.on('approval_required', async (event: any) => {
    const data = event.data;
    console.log(`[Squire] Approval required: ${data.toolName}`);

    // Handle AskUserQuestion specially - present UI in Discord
    if (data.toolName === 'AskUserQuestion') {
      // Get workspace from event
      const workspaceId = data.workspaceId as string | undefined;
      if (!workspaceId) {
        console.error('[Squire] AskUserQuestion missing workspaceId');
        await squire.respondToApproval(data.requestId, false);
        return;
      }

      // Try to handle the question
      const handled = await handleAskUserQuestion(squire, data, workspaceId);
      if (!handled) {
        // No channel registered, deny the request
        console.error(`[Squire] No channel for AskUserQuestion in workspace ${workspaceId}`);
      }
    }
  });

  // Create plugin loader
  const pluginsDir = config.plugins?.pluginsDir || path.join(getSquireBotDir(), 'plugins');
  const pluginLoader = createPluginLoader({
    pluginsDir,
    client,
    squireId: squireConfig.squireId,
    squireName: squireConfig.name,
    squire,
    safeMode: useSafeMode,
    autoEnable: config.plugins?.autoEnable ?? true,
    config: config as unknown as Record<string, any>,
    getOrCreateWorkspace: async (channelId, channelName, source) => {
      return workspaceManager.getOrCreateWorkspace(
        channelId,
        channelName,
        source as 'discord_dm' | 'discord_channel' | 'discord_forum'
      );
    },
    registerChannel: (workspaceId, channel) => {
      communicator.registerChannel(workspaceId, channel);
    },
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[SquireBot] Logged in as ${readyClient.user.tag}`);

    // Set status
    readyClient.user.setPresence({
      activities: [{ name: 'for tasks', type: ActivityType.Watching }],
      status: 'online',
    });

    // Start Squire
    await squire.start();
    console.log('[SquireBot] Squire core started');

    // Load plugins
    if (!useSafeMode) {
      console.log(`[SquireBot] Loading plugins from ${pluginsDir}...`);
      const plugins = await pluginLoader.loadAll();
      const loaded = Array.from(plugins.values()).filter(p => p.state === 'loaded');
      const errors = Array.from(plugins.values()).filter(p => p.state === 'error');

      console.log(`[SquireBot] Loaded ${loaded.length} plugins`);
      if (errors.length > 0) {
        console.log(`[SquireBot] ${errors.length} plugins failed to load`);
        for (const err of errors) {
          console.log(`[SquireBot]   - ${err.plugin.name}: ${err.error}`);
        }
      }
    } else {
      console.log('[SquireBot] Skipping plugin load (safe mode)');
    }

    // Set up message handlers
    setupMessageHandler(client, squire, workspaceManager, communicator);
    setupDmHandler(client, squire, workspaceManager, communicator);
    // Note: Forum handler is now a plugin, loaded by pluginLoader

    // Set up question handlers for AskUserQuestion
    setupQuestionHandlers(squire, client);

    // Set up slash command handler
    setupSlashCommandHandler(client, squire);

    // Register slash commands with Discord
    try {
      await registerSlashCommands(config.discordToken, config.discordAppId);
    } catch (error) {
      console.error('[SquireBot] Failed to register slash commands:', error);
      // Continue anyway - bot still works without slash commands
    }

    console.log('[SquireBot] Ready! Send me a message on Discord.');
  });

  // Handle errors
  client.on(Events.Error, (error) => {
    console.error('[SquireBot] Discord client error:', error);
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('[SquireBot] Shutting down...');

    // Unload all plugins
    const plugins = pluginLoader.getAll();
    for (const [name] of plugins) {
      await pluginLoader.unload(name);
    }

    await squire.stop();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Login
  try {
    await client.login(config.discordToken);
  } catch (error) {
    console.error('[SquireBot] Failed to login:', error);
    process.exit(1);
  }
}

/**
 * Set up general message handler for guild channels
 */
function setupMessageHandler(
  client: Client,
  squire: Squire,
  workspaceManager: WorkspaceManager,
  communicator: DiscordCommunicator
): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Skip DMs and forum threads (handled separately)
    if (message.channel.type === ChannelType.DM) return;
    if (message.channel.isThread()) return;

    // Get or create workspace for commands
    const channelName = 'name' in message.channel ? (message.channel as { name: string }).name : 'unknown';
    const workspaceId = await workspaceManager.getOrCreateWorkspace(
      message.channelId,
      channelName,
      'discord_channel'
    );

    // Check for commands first (no mention needed for ! commands)
    const commandHandled = await handleCommand(message, squire, workspaceId);
    if (commandHandled) return;

    // Only respond to mentions or replies for regular chat
    const botMention = `<@${client.user?.id}>`;
    if (!message.content.includes(botMention) && !message.mentions.has(client.user?.id || '')) {
      return;
    }

    // Remove the mention from the message
    const content = message.content.replace(botMention, '').trim();
    if (!content) return;

    console.log(`[Guild] ${message.author.username}: ${content.slice(0, 50)}...`);

    // Register channel for responses
    if (message.channel.isTextBased() && 'send' in message.channel) {
      communicator.registerChannel(workspaceId, message.channel as TextChannel);
      // Also register for AskUserQuestion handling
      registerQuestionChannel(workspaceId, message.channel as TextChannel);
    }

    // Send to Squire
    try {
      await squire.sendMessage(workspaceId, content);
    } catch (error) {
      console.error('[Guild] Error:', error);
      await message.reply('An error occurred processing your request.');
    }
  });

  // Set up command handler
  setupCommandHandler(client, squire);
  console.log('[Guild] Message handler initialized');
}

main().catch((error) => {
  console.error('[SquireBot] Fatal error:', error);
  process.exit(1);
});
