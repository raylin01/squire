/**
 * Slash Command Handler
 *
 * Defines and registers slash commands with Discord, and handles interactions.
 */

import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Client,
} from 'discord.js';
import type { Squire } from '@squire/core';

// Command definitions
const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Get Squire status and current activity'),

  new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Memory operations')
    .addSubcommand(sub =>
      sub
        .setName('remember')
        .setDescription('Store something in memory')
        .addStringOption(opt =>
          opt.setName('content').setDescription('What to remember').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('recall')
        .setDescription('Search memories')
        .addStringOption(opt =>
          opt.setName('query').setDescription('Search query').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('overview').setDescription('Get memory overview')
    ),

  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Task scheduling')
    .addSubcommand(sub =>
      sub
        .setName('schedule')
        .setDescription('Schedule a task')
        .addStringOption(opt =>
          opt.setName('description').setDescription('Task description').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('when').setDescription('When to run (e.g., "in 1 hour", "tomorrow at 9am")').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('List scheduled tasks')
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel a scheduled task')
        .addStringOption(opt =>
          opt.setName('task_id').setDescription('Task ID to cancel').setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuration')
    .addSubcommand(sub =>
      sub
        .setName('provider')
        .setDescription('Switch AI provider')
        .addStringOption(opt =>
          opt
            .setName('name')
            .setDescription('Provider name')
            .setRequired(true)
            .addChoices(
              { name: 'Claude', value: 'claude' },
              { name: 'Gemini', value: 'gemini' },
              { name: 'Codex', value: 'codex' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('show').setDescription('Show current configuration')
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with Squire commands'),
].map(cmd => cmd.toJSON());

/**
 * Register slash commands with Discord
 */
export async function registerSlashCommands(
  token: string,
  appId: string,
  guildId?: string
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('[SlashCommands] Registering commands...');

    if (guildId) {
      // Register for specific guild (faster for dev)
      await rest.put(
        Routes.applicationGuildCommands(appId, guildId),
        { body: commands }
      );
      console.log(`[SlashCommands] Registered ${commands.length} commands for guild ${guildId}`);
    } else {
      // Register globally (takes up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(appId),
        { body: commands }
      );
      console.log(`[SlashCommands] Registered ${commands.length} global commands`);
    }
  } catch (error) {
    console.error('[SlashCommands] Failed to register commands:', error);
    throw error;
  }
}

/**
 * Delete all slash commands
 */
export async function deleteSlashCommands(
  token: string,
  appId: string,
  guildId?: string
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(appId, guildId),
        { body: [] }
      );
    } else {
      await rest.put(
        Routes.applicationCommands(appId),
        { body: [] }
      );
    }
    console.log('[SlashCommands] Deleted all commands');
  } catch (error) {
    console.error('[SlashCommands] Failed to delete commands:', error);
  }
}

/**
 * Handle slash command interactions
 */
export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  squire: Squire
): Promise<void> {
  const { commandName } = interaction;

  // Defer reply for longer operations
  await interaction.deferReply({ ephemeral: true });

  try {
    switch (commandName) {
      case 'status':
        await handleStatus(interaction, squire);
        break;

      case 'memory':
        await handleMemory(interaction, squire);
        break;

      case 'task':
        await handleTask(interaction, squire);
        break;

      case 'config':
        await handleConfig(interaction, squire);
        break;

      case 'help':
        await handleHelp(interaction);
        break;

      default:
        await interaction.editReply(`Unknown command: ${commandName}`);
    }
  } catch (error) {
    console.error(`[SlashCommands] Error handling ${commandName}:`, error);
    await interaction.editReply('An error occurred processing your command.');
  }
}

// Command handlers

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  squire: Squire
): Promise<void> {
  const status = squire.getStatus();

  await interaction.editReply(
    `**Squire Status**\n` +
    `• Running: ${status.running ? 'Yes' : 'No'}\n` +
    `• Activity: ${status.activity}\n` +
    `• SDK: ${status.sdk}\n` +
    `• Last Heartbeat: ${status.lastHeartbeat}`
  );
}

async function handleMemory(
  interaction: ChatInputCommandInteraction,
  squire: Squire
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'remember': {
      const content = interaction.options.getString('content', true);
      const entry = await squire.remember(content);
      await interaction.editReply(`Remembered: "${content.slice(0, 50)}..." (ID: ${entry.id})`);
      break;
    }

    case 'recall': {
      const query = interaction.options.getString('query', true);
      const results = await squire.recall(query, 5);

      if (results.length === 0) {
        await interaction.editReply('No memories found matching that query.');
        return;
      }

      const memories = results
        .map((r, i) => `${i + 1}. ${r.entry.content.slice(0, 100)}...`)
        .join('\n');

      await interaction.editReply(`**Found ${results.length} memories:**\n${memories}`);
      break;
    }

    case 'overview': {
      const overview = await squire.getMemoryOverview();
      await interaction.editReply(overview || 'Memory system not available.');
      break;
    }

    default:
      await interaction.editReply(`Unknown memory subcommand: ${subcommand}`);
  }
}

async function handleTask(
  interaction: ChatInputCommandInteraction,
  squire: Squire
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'schedule': {
      const description = interaction.options.getString('description', true);
      const when = interaction.options.getString('when', true);

      // Parse the "when" string into a schedule
      // For now, just acknowledge - actual scheduling would need more parsing
      await interaction.editReply(
        `Task scheduled: "${description}"\n` +
        `When: ${when}\n` +
        `Note: Full scheduling requires daemon mode.`
      );
      break;
    }

    case 'list': {
      const tasks = squire.getTasks();

      if (tasks.length === 0) {
        await interaction.editReply('No scheduled tasks.');
        return;
      }

      const taskList = tasks
        .map(t => `• ${t.taskId}: ${t.description} (${t.status})`)
        .join('\n');

      await interaction.editReply(`**Scheduled Tasks:**\n${taskList}`);
      break;
    }

    case 'cancel': {
      const taskId = interaction.options.getString('task_id', true);

      try {
        await squire.cancelTask(taskId);
        await interaction.editReply(`Cancelled task: ${taskId}`);
      } catch {
        await interaction.editReply(`Failed to cancel task: ${taskId}`);
      }
      break;
    }

    default:
      await interaction.editReply(`Unknown task subcommand: ${subcommand}`);
  }
}

async function handleConfig(
  interaction: ChatInputCommandInteraction,
  squire: Squire
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'provider': {
      const provider = interaction.options.getString('name', true) as 'claude' | 'gemini' | 'codex';

      try {
        await squire.switchSDK(provider);
        await interaction.editReply(`Switched to ${provider} provider.`);
      } catch (error) {
        await interaction.editReply(`Failed to switch provider: ${error}`);
      }
      break;
    }

    case 'show': {
      const config = squire.getConfig();
      await interaction.editReply(
        `**Configuration**\n` +
        `• Squire ID: ${config.squireId}\n` +
        `• Name: ${config.name}\n` +
        `• Provider: ${config.sdk.provider}\n` +
        `• Permission Mode: ${config.permissions.mode}\n` +
        `• Memory: ${config.memory.enabled ? 'Enabled' : 'Disabled'}`
      );
      break;
    }

    default:
      await interaction.editReply(`Unknown config subcommand: ${subcommand}`);
  }
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.editReply(
    `**Squire Commands**\n\n` +
    `**/status** - Check Squire status and activity\n\n` +
    `**/memory**\n` +
    `  • remember <content> - Store something in memory\n` +
    `  • recall <query> - Search memories\n` +
    `  • overview - Get memory overview\n\n` +
    `**/task**\n` +
    `  • schedule <description> <when> - Schedule a task\n` +
    `  • list - List scheduled tasks\n` +
    `  • cancel <task_id> - Cancel a task\n\n` +
    `**/config**\n` +
    `  • provider <name> - Switch AI provider (claude/gemini/codex)\n` +
    `  • show - Show current configuration\n\n` +
    `**/help** - Show this help message\n\n` +
    `You can also just message me directly or mention me in a channel!`
  );
}

/**
 * Set up slash command handler on the client
 */
export function setupSlashCommandHandler(client: Client, squire: Squire): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    await handleSlashCommand(interaction, squire);
  });

  console.log('[SlashCommands] Handler initialized');
}
