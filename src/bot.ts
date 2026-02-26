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
  Partials,
  Events,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
  ChannelType,
  Message,
  TextChannel,
} from 'discord.js';
import { Squire, createSquire } from './index.js';
import type { WorkspaceSource } from './index.js';
import { loadConfig, saveConfig, createDefaultConfig, getConfigPath, getSquireBotDir, getWorkspaceSandboxDir } from './bot/config.js';
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
import { PluginLoader, createPluginLoader, setPluginLoader } from './bot/plugins/index.js';
import type { PluginInfo } from './bot/plugins/index.js';
import { DiscordCommunicator } from './bot/discord-communicator.js';
import { DiscordOutputRouter } from './bot/output-router.js';
import path from 'path';

/**
 * Manages the mapping between Discord channels and Squire workspaces
 */
class WorkspaceManager {
  private squire: Squire;
  private config: SquireBotConfig;
  private channelToWorkspace = new Map<string, string>(); // channelId -> workspaceId
  private workspaceToChannel = new Map<string, string>(); // workspaceId -> channelId

  constructor(squire: Squire, config: SquireBotConfig) {
    this.squire = squire;
    this.config = config;
    // Restore mappings from saved workspaces
    this.restoreFromSavedWorkspaces();
  }

  /**
   * Restore channel mappings from saved workspaces
   */
  private restoreFromSavedWorkspaces(): void {
    const workspaces = this.squire.getWorkspaces();
    for (const workspace of workspaces) {
      if (workspace.sourceId) {
        this.channelToWorkspace.set(workspace.sourceId, workspace.workspaceId);
        this.workspaceToChannel.set(workspace.workspaceId, workspace.sourceId);
        console.log(`[Workspace] Restored mapping: ${workspace.sourceId} <-> ${workspace.workspaceId}`);
      }
    }
  }

  /**
   * Get or create a workspace for a Discord channel
   */
  async getOrCreateWorkspace(channelId: string, channelName: string, source: 'discord_dm' | 'discord_channel' | 'discord_forum'): Promise<string> {
    let workspaceId = this.channelToWorkspace.get(channelId);

    if (!workspaceId) {
      // Check if Squire already has a workspace for this source
      const existing = this.squire.getWorkspaceBySource(source, channelId);
      if (existing) {
        workspaceId = existing.workspaceId;
        this.channelToWorkspace.set(channelId, workspaceId);
        this.workspaceToChannel.set(workspaceId, channelId);
        console.log(`[Workspace] Reconnected to ${workspaceId} for ${source}:${channelName}`);
      } else {
        // Build workspace options
        // Each workspace gets its own sandbox directory for isolation
        const tempId = `temp-${Date.now()}`;
        const workspaceOptions: {
          name: string;
          source: WorkspaceSource;
          sourceId: string;
          context?: { projectPath: string; sandboxPath: string };
        } = {
          name: channelName,
          source,
          sourceId: channelId,
        };

        // Create workspace first to get the real workspaceId
        const workspace = await this.squire.createWorkspace(workspaceOptions);
        workspaceId = workspace.workspaceId;

        // Now create sandbox directory using the real workspaceId
        const sandboxDir = getWorkspaceSandboxDir(workspaceId);

        // Update workspace with sandbox path (and optionally default project path)
        workspace.context = {
          ...workspace.context,
          sandboxPath: sandboxDir,
          // Use defaultProjectPath if configured, otherwise use sandbox
          projectPath: this.config.defaultProjectPath || sandboxDir,
        };

        // Save the updated workspace
        await this.squire.saveWorkspaces();

        console.log(`[Workspace] Created ${workspaceId} for ${source}:${channelName} (sandbox: ${sandboxDir})`);
        this.channelToWorkspace.set(channelId, workspaceId);
        this.workspaceToChannel.set(workspaceId, channelId);
      }
    }

    return workspaceId;
  }

  /**
   * Get workspace ID for a channel
   */
  getWorkspace(channelId: string): string | undefined {
    return this.channelToWorkspace.get(channelId);
  }

  /**
   * Get channel ID for a workspace
   */
  getChannelId(workspaceId: string): string | undefined {
    return this.workspaceToChannel.get(workspaceId);
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
    const squireModel = args.find(a => a.startsWith('--model='))?.split('=')[1];

    if (!token || !appId) {
      console.error('Usage: squire-bot init --token=YOUR_DISCORD_BOT_TOKEN --app-id=YOUR_APP_ID [--provider=claude|gemini|codex] [--model=MODEL_NAME]');
      process.exit(1);
    }

    const config = createDefaultConfig(token, appId);
    if (squireProvider) {
      config.squire = { ...config.squire, provider: squireProvider };
    }
    if (squireModel) {
      config.squire = { ...config.squire, model: squireModel };
    }

    saveConfig(config);
    console.log(`[SquireBot] Config created at ${getConfigPath()}`);
    console.log(`[SquireBot] Provider: ${config.squire?.provider || 'gemini'}`);
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
  if (process.env.SQUIRE_SDK_PROVIDER) {
    config = {
      ...config,
      squire: {
        ...config.squire,
        provider: process.env.SQUIRE_SDK_PROVIDER as 'claude' | 'gemini' | 'codex',
      },
    };
  }
  if (process.env.SQUIRE_SDK_MODEL) {
    config = {
      ...config,
      squire: {
        ...config.squire,
        model: process.env.SQUIRE_SDK_MODEL,
      },
    };
  }
  if (process.env.SQUIRE_PERMISSION_MODE) {
    config = {
      ...config,
      squire: {
        ...config.squire,
        permissionMode: process.env.SQUIRE_PERMISSION_MODE as 'strict' | 'autoSafe' | 'permissive',
      },
    };
  }
  if (process.env.SQUIRE_DAEMON_MODE) {
    const daemonMode = process.env.SQUIRE_DAEMON_MODE.toLowerCase() === 'true';
    config = {
      ...config,
      squire: {
        ...config.squire,
        daemonMode,
      },
    };
  }
  if (process.env.SQUIRE_POLL_INTERVAL) {
    const pollInterval = parseInt(process.env.SQUIRE_POLL_INTERVAL, 10);
    if (!Number.isNaN(pollInterval) && pollInterval > 0) {
      config = {
        ...config,
        squire: {
          ...config.squire,
          pollInterval,
        },
      };
    }
  }
  if (process.env.SQUIRE_OUTPUT_THROTTLE_MS) {
    const outputThrottleMs = parseInt(process.env.SQUIRE_OUTPUT_THROTTLE_MS, 10);
    if (!Number.isNaN(outputThrottleMs) && outputThrottleMs >= 0) {
      config = {
        ...config,
        squire: {
          ...config.squire,
          outputThrottleMs,
        },
      };
    } else {
      console.warn(`[SquireBot] Ignoring invalid SQUIRE_OUTPUT_THROTTLE_MS: ${process.env.SQUIRE_OUTPUT_THROTTLE_MS}`);
    }
  }

  const configuredThrottleMs = config.squire?.outputThrottleMs;
  const effectiveThrottleMs = Number.isFinite(configuredThrottleMs) && (configuredThrottleMs as number) >= 0
    ? Math.floor(configuredThrottleMs as number)
    : 1200;
  process.env.SQUIRE_OUTPUT_THROTTLE_MS = String(effectiveThrottleMs);
  console.log(`[SquireBot] Output throttle: ${effectiveThrottleMs}ms`);

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
    partials: [
      Partials.Channel,  // Required for DM events
    ],
  });

  // Create Squire instance
  const squireConfig = {
    squireId: `squire-${Date.now()}`,
    name: config.name || 'Squire',
    sdk: {
      provider: (config.squire?.provider || 'gemini') as 'claude' | 'gemini' | 'codex',
      model: config.squire?.model,
      cliPath: config.squire?.cliPath,
      resumeSessionId: config.resumeSessionId,
      outputThrottleMs: effectiveThrottleMs,
    },
    permissions: {
      mode: (config.squire?.permissionMode || 'autoSafe') as 'strict' | 'autoSafe' | 'permissive',
      allowedTools: [],
      blockedTools: [],
    },
    memory: {
      enabled: true,
      provider: 'qmd' as const,
      retentionDays: 90,
    },
    daemonMode: config.squire?.daemonMode ?? true,
    pollInterval: config.squire?.pollInterval ?? 60000,
  };

  const squire = createSquire(squireConfig);
  const workspaceManager = new WorkspaceManager(squire, config);
  const communicator = new DiscordCommunicator(client);
  const outputRouter = new DiscordOutputRouter(communicator);

  // Save session ID after Squire starts (SDK will have created/resumed a session)
  squire.on('squire_started', async () => {
    // Get the session ID from the SDK client if available
    const sdkClient = (squire as any).sdkClient;
    if (sdkClient?.client?.sessionId) {
      const sessionId = sdkClient.client.sessionId;
      if (sessionId && sessionId !== config.resumeSessionId) {
        config.resumeSessionId = sessionId;
        saveConfig(config);
        console.log(`[SquireBot] Saved session ID: ${sessionId}`);
      }
    }
  });

  // Handle Squire communication events
  squire.on('communication', async (event: any) => {
    try {
      const data = event.data;
      console.log(`[Communication] Event received:`, JSON.stringify(data));

      // Find which workspace this came from
      const workspaceId = data.workspaceId as string | undefined;
      if (!workspaceId) {
        console.warn('[Communication] No workspaceId, cannot send message');
        return;
      }

      console.log(`[Communication] Sending to workspace ${workspaceId.slice(0, 8)}...`);

      if (data.type === 'text') {
        await communicator.sendText(workspaceId, data.content as string);
      } else if (data.type === 'embed') {
        await communicator.sendEmbed(
          workspaceId,
          (data.title as string) || 'Update',
          data.content as string,
          (data.color as 'green' | 'red' | 'blue') || 'blue'
        );
      } else if (data.type === 'file' && data.filePath) {
        await communicator.sendFile(
          workspaceId,
          data.filePath as string,
          data.content as string | undefined
        );
      }
    } catch (error) {
      console.error('[Communication] Handler error:', error);
    }
  });

  // Handle status updates (typing indicator, activity)
  squire.on('status', (event: any) => {
    const data = event.data;
    const activity = data.activity as string;
    const workspaceId = data.workspaceId as string | undefined;

    console.log(`[Squire] Status: ${activity} (workspace: ${workspaceId})`);

    // Update typing indicator for the active workspace
    if (workspaceId) {
      if (activity === 'thinking' || activity === 'working') {
        if (activity === 'thinking') {
          // New turn start: reset per-turn continuation tracking.
          outputRouter.resetWorkspace(workspaceId);
        }
        // Start typing indicator when processing
        communicator.startTyping(workspaceId);
      } else if (activity === 'ready' || activity === 'error') {
        // Stop typing when done or errored
        communicator.stopTyping(workspaceId);
      }
    }

    // Update global Discord presence (shows in member list)
    let presenceText = 'for tasks';
    let discordStatus: 'online' | 'idle' | 'dnd' = 'online';

    if (activity === 'thinking' || activity === 'working') {
      presenceText = 'thinking...';
      discordStatus = 'online';
    } else if (activity === 'awaiting approval') {
      presenceText = 'awaiting approval';
      discordStatus = 'idle';
    } else if (activity === 'ready') {
      presenceText = 'for tasks';
      discordStatus = 'online';
    } else if (activity === 'error') {
      presenceText = 'error';
      discordStatus = 'dnd';
    }

    client.user?.setPresence({
      activities: [{ name: presenceText, type: ActivityType.Watching }],
      status: discordStatus,
    });
  });

  // Handle SDK output events - stream messages to Discord
  squire.on('output', async (event: any) => {
    try {
      await outputRouter.handleOutput(event.data);
    } catch (error) {
      console.error('[Squire] Output handler error:', error);
    }
  });

  // Handle tool_use events - break message stream when tool is used
  squire.on('tool_use', async (event: any) => {
    const workspaceId = event.data?.workspaceId as string | undefined;
    outputRouter.handleToolUse(workspaceId);
  });

  // Handle complete events - session finished
  squire.on('complete', async (event: any) => {
    const data = event.data;
    const workspaceId = data.workspaceId as string | undefined;
    console.log(`[Squire] Session complete for workspace: ${workspaceId}`);
    outputRouter.handleComplete(workspaceId);
  });

  // Handle scheduled task failures that need user action.
  squire.on('task_failed', async (event: any) => {
    try {
      const data = event.data;
      const task = data.task as { taskId: string; workspaceId: string; description: string; status: string; result?: { parsedSummary?: string; error?: string; suggestedFixes?: string[] } } | undefined;
      if (!task?.workspaceId) {
        return;
      }

      const channel = communicator.getChannel(task.workspaceId);
      if (!channel) {
        console.warn(`[Squire] Task ${task.taskId} failed but no channel is mapped for workspace ${task.workspaceId}`);
        return;
      }

      const summary = task.result?.parsedSummary || task.result?.error || 'Scheduled task failed.';
      const fixes = (task.result?.suggestedFixes || [])
        .slice(0, 4)
        .map(f => `• ${f}`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle('Scheduled Task Needs Attention')
        .setDescription([
          `**Task:** ${task.description}`,
          `**Status:** ${task.status}`,
          '',
          summary,
          fixes ? `\n**Suggested Actions**\n${fixes}` : '',
        ].join('\n'))
        .setColor(0xff8800)
        .setFooter({ text: `Task ID: ${task.taskId}` })
        .setTimestamp();

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`sched_retry_${task.taskId}`).setLabel('Retry now').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sched_skip_${task.taskId}`).setLabel('Skip run').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sched_disable_${task.taskId}`).setLabel('Disable task').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`sched_autofix_${task.taskId}`).setLabel('Auto-fix + retry').setStyle(ButtonStyle.Primary)
      );

      await channel.send({ embeds: [embed], components: [actionRow] });
    } catch (error) {
      console.error('[Squire] task_failed handler error:', error);
    }
  });

  // Handle approval requests
  squire.on('approval_required', async (event: any) => {
    const data = event.data;
    console.log(`[Squire] Approval required: ${data.toolName}`);

    const workspaceId = data.workspaceId as string | undefined;

    outputRouter.handleApprovalRequired(workspaceId);

    // Handle AskUserQuestion specially - present UI in Discord
    if (data.toolName === 'AskUserQuestion') {
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
      return;
    }

    // Handle general tool approvals - show prompt in Discord
    if (workspaceId) {
      const channel = communicator.getChannel(workspaceId);
      if (channel) {
        // Build approval message
        let description = `**Tool:** ${data.toolName}`;
        if (data.toolName === 'bash' || data.toolName === 'Bash') {
          const command = data.toolInput?.command as string;
          description += `\n**Command:** \`${command?.slice(0, 100)}${command && command.length > 100 ? '...' : ''}\``;
        }
        if (data.reason) {
          description += `\n**Reason:** ${data.reason}`;
        }
        description += `\n\nType \`!approve\` to allow or \`!deny\` to reject.`;

        const embed = new EmbedBuilder()
          .setTitle('Approval Required')
          .setDescription(description)
          .setColor(0xFFA500);  // Orange

        try {
          await channel.send({ embeds: [embed] });
        } catch (error) {
          console.error('[Squire] Failed to send approval prompt:', error);
        }
      } else {
        console.log(`[Squire] No channel for workspace ${workspaceId}, auto-deny`);
        await squire.respondToApproval(data.requestId, false, workspaceId);
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

  // Set global plugin loader reference for commands
  setPluginLoader(pluginLoader);

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

    // Restore channel mappings from saved workspaces
    const savedWorkspaces = squire.getWorkspaces();
    await communicator.restoreChannels(savedWorkspaces);
    console.log(`[SquireBot] Restored ${savedWorkspaces.length} workspace channel mappings`);

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
    setupScheduledTaskActionHandler(client, squire);

    // Set up slash command handler
    setupSlashCommandHandler(client, squire);

    // Register slash commands with Discord
    // If DISCORD_GUILD_ID is set, commands register instantly (for dev)
    // Otherwise, commands register globally (takes up to 1 hour)
    const guildId = process.env.DISCORD_GUILD_ID;
    try {
      await registerSlashCommands(config.discordToken, config.discordAppId, guildId);
      if (guildId) {
        console.log(`[SquireBot] Slash commands registered for guild ${guildId} (instant)`);
      } else {
        console.log('[SquireBot] Slash commands registered globally (may take up to 1 hour to appear)');
        console.log('[SquireBot] Tip: Set DISCORD_GUILD_ID env var for instant command registration during dev');
      }
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

function parseScheduledTaskAction(customId: string): { action: 'retry' | 'skip' | 'disable' | 'autofix'; taskId: string } | null {
  if (!customId.startsWith('sched_')) {
    return null;
  }

  const [, action, ...taskIdParts] = customId.split('_');
  const taskId = taskIdParts.join('_');
  if (!taskId) return null;

  if (action === 'retry' || action === 'skip' || action === 'disable' || action === 'autofix') {
    return { action, taskId };
  }
  return null;
}

function setupScheduledTaskActionHandler(client: Client, squire: Squire): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const parsed = parseScheduledTaskAction(interaction.customId);
    if (!parsed) return;

    try {
      switch (parsed.action) {
        case 'retry':
          await squire.retryTask(parsed.taskId);
          await interaction.reply({ content: `Queued retry for task ${parsed.taskId}.`, ephemeral: true });
          break;
        case 'skip':
          await squire.skipTaskRun(parsed.taskId);
          await interaction.reply({ content: `Skipped current run for task ${parsed.taskId}.`, ephemeral: true });
          break;
        case 'disable':
          await squire.disableTask(parsed.taskId);
          await interaction.reply({ content: `Disabled task ${parsed.taskId}.`, ephemeral: true });
          break;
        case 'autofix':
          await squire.retryTask(parsed.taskId, { autoFix: true });
          await interaction.reply({ content: `Queued auto-fix retry for task ${parsed.taskId}.`, ephemeral: true });
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `Could not apply action: ${message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Could not apply action: ${message}`, ephemeral: true });
      }
    }
  });

  console.log('[Tasks] Scheduled task action handler initialized');
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
