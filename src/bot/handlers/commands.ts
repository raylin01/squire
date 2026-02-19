/**
 * Discord Command Handler
 *
 * Handles ! commands for Squire management via Discord.
 */

import {
  Message,
  EmbedBuilder,
} from 'discord.js';
import type { Client } from 'discord.js';
import type { Squire } from '../../index.js';
import {
  loadConfig,
  saveConfig,
  getSquireDir,
  PERSONALITY_TEMPLATES,
  getPersonalityTemplateList,
} from '../../index.js';
import type { PersonalityTemplateName } from '../../index.js';
import type { SquireBotConfig } from '../config.js';

const COMMAND_PREFIX = '!';

interface CommandContext {
  squire: Squire;
  workspaceId: string;
  message: Message;
}

type CommandHandler = (ctx: CommandContext, args: string[]) => Promise<string | null>;

/**
 * Available commands
 */
const COMMANDS: Record<string, { handler: CommandHandler; help: string }> = {
  help: {
    help: 'Show available commands',
    handler: async () => {
      const lines = ['**Squire Commands:**', ''];
      for (const [name, cmd] of Object.entries(COMMANDS)) {
        lines.push(`**!${name}** - ${cmd.help}`);
      }
      return lines.join('\n');
    },
  },

  name: {
    help: 'Set Squire\'s name (e.g., !name Stark)',
    handler: async (ctx, args) => {
      const newName = args.join(' ').trim();
      if (!newName) {
        return 'Please provide a name. Usage: !name <name>';
      }

      // Update squire config
      const config = ctx.squire.getConfig();
      config.name = newName;

      // Persist to file
      const squireConfig = loadConfig();
      if (squireConfig) {
        squireConfig.name = newName;
        saveConfig(squireConfig);
      }

      return `My name is now **${newName}**! Nice to meet you.`;
    },
  },

  personality: {
    help: 'Set personality (e.g., !personality helpful) or show current',
    handler: async (ctx, args) => {
      const subCommand = args[0]?.toLowerCase();

      if (!subCommand || subCommand === 'show') {
        const config = ctx.squire.getConfig();
        const personality = config.personality.default;
        const traits = personality.traits;

        return [
          `**Current Personality: ${personality.name}**`,
          `${personality.description}`,
          '',
          `**Traits:**`,
          `• Tone: ${traits.tone}`,
          `• Verbosity: ${traits.verbosity}`,
          `• Technicality: ${traits.technicality}`,
          `• Enthusiasm: ${traits.enthusiasm}`,
          `• Humor: ${traits.humor}`,
          '',
          'Use `!personality list` to see available templates',
          'Use `!personality <name>` to change',
        ].join('\n');
      }

      if (subCommand === 'list') {
        const templates = getPersonalityTemplateList();
        const lines = ['**Available Personalities:**', ''];
        for (const t of templates) {
          lines.push(`**${t.name}** - ${t.displayName}: ${t.description}`);
        }
        return lines.join('\n');
      }

      // Try to set personality
      const template = PERSONALITY_TEMPLATES[subCommand as PersonalityTemplateName];
      if (!template) {
        return `Unknown personality: ${subCommand}. Use \`!personality list\` to see options.`;
      }

      // Update config
      const config = ctx.squire.getConfig();
      config.personality.default = { ...template };

      // Persist
      const squireConfig = loadConfig();
      if (squireConfig) {
        squireConfig.personality.default = { ...template };
        saveConfig(squireConfig);
      }

      // Update personality manager
      const pm = ctx.squire.getPersonalityManager();
      if (pm) {
        pm.setDefault({ ...template });
      }

      return `Personality changed to **${template.name}**!`;
    },
  },

  remember: {
    help: 'Store something in memory (e.g., !remember I prefer TypeScript)',
    handler: async (ctx, args) => {
      const content = args.join(' ').trim();
      if (!content) {
        return 'Please provide something to remember. Usage: !remember <content>';
      }

      try {
        await ctx.squire.remember(content, {
          source: 'user',
          workspaceId: ctx.workspaceId,
        });
        return `Got it! I'll remember: "${content}"`;
      } catch (error) {
        return `Failed to remember: ${error}`;
      }
    },
  },

  recall: {
    help: 'Search memories (e.g., !recall TypeScript)',
    handler: async (ctx, args) => {
      const query = args.join(' ').trim();
      if (!query) {
        return 'Please provide a search query. Usage: !recall <query>';
      }

      try {
        const results = await ctx.squire.recall(query, 5);
        if (results.length === 0) {
          return `No memories found for "${query}"`;
        }

        const lines = [`**Memories matching "${query}":**`, ''];
        for (const r of results) {
          const preview = r.entry.content.slice(0, 100);
          lines.push(`• ${preview}${r.entry.content.length > 100 ? '...' : ''}`);
        }
        return lines.join('\n');
      } catch (error) {
        return `Failed to recall: ${error}`;
      }
    },
  },

  tools: {
    help: 'List available tools',
    handler: async (ctx) => {
      // Get tool registry
      const { toolRegistry } = await import('../../index.js');
      const tools = toolRegistry.getAll();

      if (tools.length === 0) {
        return 'No tools available.';
      }

      const lines = ['**Available Tools:**', ''];
      for (const tool of tools) {
        const source = tool.source === 'external' ? ' (external)' : '';
        lines.push(`• **${tool.name}**${source}: ${tool.description}`);
      }

      lines.push('');
      lines.push('You can ask me to use any of these tools!');

      return lines.join('\n');
    },
  },

  status: {
    help: 'Show Squire status',
    handler: async (ctx) => {
      const status = ctx.squire.getStatus();
      const config = ctx.squire.getConfig();

      return [
        '**Squire Status:**',
        `• Name: ${config.name}`,
        `• Running: ${status.running ? 'Yes' : 'No'}`,
        `• Activity: ${status.activity}`,
        `• SDK: ${status.sdk}`,
        `• Memory: ${config.memory.enabled ? 'Enabled' : 'Disabled'}`,
      ].join('\n');
    },
  },

  reset: {
    help: 'Reset workspace personality to default',
    handler: async (ctx) => {
      ctx.squire.clearWorkspacePersonality(ctx.workspaceId);
      return 'Workspace personality reset to default.';
    },
  },

  memory: {
    help: 'View memory overview or today\'s log (e.g., !memory overview, !memory today)',
    handler: async (ctx, args) => {
      const subCommand = args[0]?.toLowerCase() || 'overview';

      if (subCommand === 'overview') {
        // Get memory overview
        const overview = await ctx.squire.getMemoryOverview();
        if (!overview) {
          return 'Memory system not initialized.';
        }
        return overview;
      }

      if (subCommand === 'today' || subCommand === 'daily') {
        // Get today's summary
        const summary = await ctx.squire.getDailySummary();
        return summary;
      }

      if (subCommand === 'recent') {
        // Get recent activity
        const activity = await ctx.squire.getRecentMemoryActivity(7);
        if (!activity) {
          return 'No recent activity found.';
        }

        const lines = [
          '**Recent Activity (7 days):**',
          `• Commits: ${activity.totalCommits}`,
          `• Tasks Completed: ${activity.totalTasks}`,
          `• Active Projects: ${activity.activeWorkspaces.join(', ') || 'none'}`,
        ];

        if (activity.highlights.length > 0) {
          lines.push('', '**Highlights:**');
          for (const h of activity.highlights.slice(0, 5)) {
            lines.push(`• ${h}`);
          }
        }

        return lines.join('\n');
      }

      return [
        '**Memory Commands:**',
        '• `!memory overview` - View core memory and preferences',
        '• `!memory today` - View today\'s activity log',
        '• `!memory recent` - View recent activity (7 days)',
      ].join('\n');
    },
  },

  today: {
    help: 'View today\'s activity log',
    handler: async (ctx) => {
      const summary = await ctx.squire.getDailySummary();
      return summary;
    },
  },

  prefer: {
    help: 'Record a preference (e.g., !prefer TypeScript)',
    handler: async (ctx, args) => {
      const preference = args.join(' ').trim();
      if (!preference) {
        return 'Please provide a preference. Usage: !prefer <preference>';
      }

      try {
        await ctx.squire.recordMemoryPreference(preference);
        return `Recorded preference: "${preference}"`;
      } catch (error) {
        return `Failed to record preference: ${error}`;
      }
    },
  },

  fact: {
    help: 'Record a fact (e.g., !fact I work at Acme)',
    handler: async (ctx, args) => {
      const fact = args.join(' ').trim();
      if (!fact) {
        return 'Please provide a fact. Usage: !fact <fact>';
      }

      try {
        await ctx.squire.recordMemoryFact(fact);
        return `Recorded fact: "${fact}"`;
      } catch (error) {
        return `Failed to record fact: ${error}`;
      }
    },
  },

  project: {
    help: 'Set or show the workspace project directory (e.g., !project /path/to/repo)',
    handler: async (ctx, args) => {
      const projectPath = args.join(' ').trim();

      if (!projectPath) {
        // Show current project path
        const workspace = ctx.squire.getWorkspace(ctx.workspaceId);
        const currentPath = workspace?.context?.projectPath;
        if (currentPath) {
          return `Current project directory: \`${currentPath}\``;
        }
        return 'No project directory set. Use `!project /path/to/repo` to set one.';
      }

      // Validate path exists
      const fs = await import('fs');
      if (!fs.existsSync(projectPath)) {
        return `Path does not exist: \`${projectPath}\``;
      }

      // Update workspace context
      const workspace = ctx.squire.getWorkspace(ctx.workspaceId);
      if (workspace) {
        workspace.context = workspace.context || {};
        workspace.context.projectPath = projectPath;
      }

      return `Project directory set to: \`${projectPath}\``;
    },
  },

  cd: {
    help: 'Change workspace directory (alias for !project)',
    handler: async (ctx, args) => {
      // Just delegate to project command
      return COMMANDS.project.handler(ctx, args);
    },
  },
};

/**
 * Process a message for commands
 * Returns true if a command was handled
 */
export async function handleCommand(
  message: Message,
  squire: Squire,
  workspaceId: string
): Promise<boolean> {
  const content = message.content.trim();

  // Check for command prefix
  if (!content.startsWith(COMMAND_PREFIX)) {
    return false;
  }

  // Parse command and args
  const parts = content.slice(COMMAND_PREFIX.length).split(/\s+/);
  const commandName = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!commandName) {
    return false;
  }

  // Find command
  const command = COMMANDS[commandName];
  if (!command) {
    // Not a known command, let it pass through to AI
    return false;
  }

  console.log(`[Command] ${message.author.username}: !${commandName} ${args.join(' ')}`);

  try {
    const response = await command.handler(
      { squire, workspaceId, message },
      args
    );

    if (response) {
      await message.reply(response);
    }

    return true;
  } catch (error) {
    console.error(`[Command] Error:`, error);
    await message.reply(`Command error: ${error}`);
    return true;
  }
}

/**
 * Set up command handler
 */
export function setupCommandHandler(
  _client: Client,
  _squire: Squire
): void {
  console.log('[Commands] Handler initialized');
}
