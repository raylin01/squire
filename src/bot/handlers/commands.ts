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
  loadConfig as loadSquireConfig,
  saveConfig as saveSquireConfig,
  getSquireDir,
  PERSONALITY_TEMPLATES,
  getPersonalityTemplateList,
} from '../../index.js';
import type { PersonalityTemplateName } from '../../index.js';
import { loadConfig, saveConfig } from '../config.js';
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

      // Update squire runtime config
      const squireConfig = ctx.squire.getConfig();
      squireConfig.name = newName;

      // Persist to file
      const botConfig = loadConfig();
      if (botConfig) {
        botConfig.name = newName;
        saveConfig(botConfig);
        console.log(`[Commands] Saved name "${newName}" to config`);
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
      const squireConfig = loadSquireConfig();
      if (squireConfig) {
        squireConfig.personality.default = { ...template };
        saveSquireConfig(squireConfig);
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
        // Show current paths
        const workspace = ctx.squire.getWorkspace(ctx.workspaceId);
        const currentProject = workspace?.context?.projectPath;
        const sandboxPath = workspace?.context?.sandboxPath;

        const lines = ['**Workspace Paths:**'];
        if (currentProject) {
          lines.push(`- Project: \`${currentProject}\``);
        }
        if (sandboxPath) {
          lines.push(`- Sandbox: \`${sandboxPath}\``);
        }
        if (!currentProject && !sandboxPath) {
          lines.push('No paths set. Using process directory.');
        }
        lines.push('');
        lines.push('Use `!project /path/to/repo` to change project directory.');
        return lines.join('\n');
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
        // Save the change
        await ctx.squire.saveWorkspaces();
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

  sandbox: {
    help: 'Reset project path to the workspace sandbox directory',
    handler: async (ctx) => {
      const workspace = ctx.squire.getWorkspace(ctx.workspaceId);
      if (!workspace) {
        return 'Workspace not found';
      }

      const sandboxPath = workspace.context?.sandboxPath;
      if (!sandboxPath) {
        return 'No sandbox directory set for this workspace.';
      }

      // Update workspace context to use sandbox
      workspace.context = {
        ...workspace.context,
        projectPath: sandboxPath,
      };
      await ctx.squire.saveWorkspaces();

      return `Project path reset to sandbox: \`${sandboxPath}\`\nRestart the bot or use \`!regenerate\` to apply the change.`;
    },
  },

  defaultproject: {
    help: 'Set default project directory for all new workspaces (e.g., !defaultproject /Users/ray/Documents/DisCode)',
    handler: async (ctx, args) => {
      const projectPath = args.join(' ').trim();

      // Load current config
      const config = loadConfig();
      if (!config) {
        return 'Error: Could not load configuration';
      }

      if (!projectPath) {
        // Show current default
        if (config.defaultProjectPath) {
          return `Default project directory: \`${config.defaultProjectPath}\``;
        }
        return 'No default project directory set. Use `!defaultproject /path/to/repo` to set one.';
      }

      // Validate path exists
      const fs = await import('fs');
      if (!fs.existsSync(projectPath)) {
        return `Path does not exist: \`${projectPath}\``;
      }

      // Update and save config
      config.defaultProjectPath = projectPath;
      saveConfig(config);

      return `Default project directory set to: \`${projectPath}\`\nNew workspaces will start in this directory.`;
    },
  },

  regenerate: {
    help: 'Reset workspace - creates fresh sandbox (only deletes if in .squirebot/workspaces)',
    handler: async (ctx, args) => {
      const workspace = ctx.squire.getWorkspace(ctx.workspaceId);
      if (!workspace) {
        return 'Workspace not found';
      }

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const { getWorkspaceSandboxDir, getSquireBotDir } = await import('../config.js');

      const squirebotDir = getSquireBotDir();
      const workspacesDir = path.join(squirebotDir, 'workspaces');
      const currentSandbox = workspace.context?.sandboxPath;
      const currentProject = workspace.context?.projectPath;

      // Check if current paths are within the safe sandbox directory
      const isSandboxSafe = currentSandbox && currentSandbox.startsWith(workspacesDir);
      const isProjectSafe = currentProject && currentProject.startsWith(workspacesDir);

      // Always create a new sandbox directory
      const newSandboxDir = getWorkspaceSandboxDir(ctx.workspaceId + '-new');

      // Delete old sandbox only if it's in the safe directory
      if (isSandboxSafe && currentSandbox && fs.existsSync(currentSandbox)) {
        try {
          fs.rmSync(currentSandbox, { recursive: true, force: true });
          console.log(`[Commands] Deleted old sandbox: ${currentSandbox}`);
        } catch (error) {
          console.warn(`[Commands] Could not delete old sandbox:`, error);
        }
      }

      // Rename new sandbox to match workspace ID
      const shortId = ctx.workspaceId.slice(0, 8);
      const finalSandboxDir = path.join(workspacesDir, shortId);
      if (newSandboxDir !== finalSandboxDir && fs.existsSync(newSandboxDir)) {
        // Remove old final dir if exists
        if (fs.existsSync(finalSandboxDir)) {
          fs.rmSync(finalSandboxDir, { recursive: true, force: true });
        }
        fs.renameSync(newSandboxDir, finalSandboxDir);
      }

      // Update workspace context - clear CLI session ID for fresh conversation
      const oldSessionId = workspace.context?.cliSessionId;
      workspace.context = {
        ...workspace.context,
        sandboxPath: finalSandboxDir,
        // Reset projectPath to sandbox unless user had a custom project
        projectPath: isProjectSafe ? finalSandboxDir : currentProject,
        // Clear CLI session ID to start fresh conversation
        cliSessionId: undefined,
      };

      await ctx.squire.saveWorkspaces();

      const lines = ['**Workspace Regenerated**', ''];
      lines.push(`- New sandbox: \`${finalSandboxDir}\``);
      if (oldSessionId) {
        lines.push(`- Conversation reset (old session cleared)`);
      }
      if (!isSandboxSafe && currentSandbox) {
        lines.push(`- Old sandbox preserved (not in .squirebot): \`${currentSandbox}\``);
      }
      if (!isProjectSafe && currentProject) {
        lines.push(`- Project path unchanged: \`${currentProject}\``);
      }
      lines.push('');
      lines.push('The workspace now has a clean slate.');

      return lines.join('\n');
    },
  },

  approve: {
    help: 'Approve a pending tool/command request',
    handler: async (ctx) => {
      console.log(`[Commands] !approve triggered for workspace ${ctx.workspaceId}`);
      const pendingId = ctx.squire.getFirstPendingApprovalId(ctx.workspaceId);
      if (!pendingId) {
        console.log(`[Commands] No pending approval found for workspace ${ctx.workspaceId}`);
        return 'No pending approval requests.';
      }

      console.log(`[Commands] Approving request ${pendingId}`);
      await ctx.squire.respondToApproval(pendingId, true, ctx.workspaceId);
      return 'Approved.';
    },
  },

  deny: {
    help: 'Deny a pending tool/command request',
    handler: async (ctx) => {
      console.log(`[Commands] !deny triggered for workspace ${ctx.workspaceId}`);
      const pendingId = ctx.squire.getFirstPendingApprovalId(ctx.workspaceId);
      if (!pendingId) {
        console.log(`[Commands] No pending approval found for workspace ${ctx.workspaceId}`);
        return 'No pending approval requests.';
      }

      console.log(`[Commands] Denying request ${pendingId}`);
      await ctx.squire.respondToApproval(pendingId, false, ctx.workspaceId);
      return 'Denied.';
    },
  },

  interrupt: {
    help: 'Interrupt the current run and reset this workspace session',
    handler: async (ctx) => {
      const interrupted = await ctx.squire.interruptWorkspaceRun(ctx.workspaceId);
      return interrupted
        ? 'Interrupted the current run and reset this workspace session.'
        : 'No active run was detected, but I reset this workspace session so you can start fresh.';
    },
  },

  patterns: {
    help: 'Manage learned command patterns. Usage: !patterns [clear|stats]',
    handler: async (ctx, args) => {
      const { getAllLearnedPatterns, clearLearnedPatterns, getLearnedPatternsStats } = await import('../../permissions/learned-patterns.js');

      const subCommand = args[0]?.toLowerCase();

      if (subCommand === 'clear') {
        clearLearnedPatterns();
        return 'Cleared all learned patterns.';
      }

      if (subCommand === 'stats') {
        const stats = getLearnedPatternsStats();
        return `Learned patterns: ${stats.count} patterns, ${stats.totalApprovals} total approvals.`;
      }

      // List all patterns
      const patterns = getAllLearnedPatterns();
      if (patterns.length === 0) {
        return 'No learned patterns yet. Patterns are added when you approve commands with !approve.';
      }

      const lines = [`**Learned Patterns (${patterns.length}):**`, ''];
      for (const p of patterns) {
        const example = p.examples[0] ? ` (e.g., \`${p.examples[0].slice(0, 50)}${p.examples[0].length > 50 ? '...' : ''}\`)` : '';
        lines.push(`- \`${p.base}\` - ${p.approvalCount} approvals${example}`);
      }
      lines.push('');
      lines.push('Use `!patterns clear` to remove all patterns.');
      lines.push('Use `!patterns stats` for summary.');

      return lines.join('\n');
    },
  },

  plugins: {
    help: 'Manage plugins. Usage: !plugins [list|reload|enable|disable] [name]',
    handler: async (ctx, args) => {
      const { getPluginLoader } = await import('../plugins/index.js');
      const pluginLoader = getPluginLoader();

      if (!pluginLoader) {
        return 'Plugin system not initialized.';
      }

      const subCommand = args[0]?.toLowerCase();
      const pluginName = args[1];

      // Default to list if no subcommand
      if (!subCommand || subCommand === 'list') {
        const plugins = pluginLoader.getAll();
        if (plugins.size === 0) {
          return 'No plugins found. Add plugins to `~/.squirebot/plugins/` directory.';
        }

        const lines = ['**Plugins:**', ''];
        for (const [name, info] of plugins) {
          const statusIcon = {
            loaded: '✅',
            disabled: '⏸️',
            error: '❌',
            loading: '⏳',
            not_found: '❓',
          }[info.state] || '❓';

          const version = info.plugin.version || '0.0.0';
          const desc = info.plugin.description ? ` - ${info.plugin.description.slice(0, 50)}...` : '';
          const errorMsg = info.error ? ` (${info.error})` : '';

          lines.push(`${statusIcon} **${name}** v${version}${desc}${errorMsg}`);
        }

        lines.push('');
        lines.push('Use `!plugins reload <name>` to hot-reload a plugin.');
        lines.push('Use `!plugins reload all` to reload all plugins.');

        return lines.join('\n');
      }

      if (subCommand === 'reload') {
        if (!pluginName) {
          return 'Please specify a plugin name or `all`. Usage: `!plugins reload <name|all>`';
        }

        if (pluginName === 'all') {
          const results = await pluginLoader.reloadAll();
          const succeeded = Array.from(results.values()).filter(p => p.state === 'loaded').length;
          const failed = results.size - succeeded;
          return `Reloaded ${succeeded} plugins successfully.${failed > 0 ? ` ${failed} failed.` : ''}`;
        }

        try {
          const info = await pluginLoader.reload(pluginName);
          if (info.state === 'loaded') {
            return `Plugin **${pluginName}** reloaded successfully.`;
          }
          return `Failed to reload **${pluginName}**: ${info.error || 'Unknown error'}`;
        } catch (error) {
          return `Error reloading **${pluginName}**: ${error}`;
        }
      }

      if (subCommand === 'enable') {
        if (!pluginName) {
          return 'Please specify a plugin name. Usage: `!plugins enable <name>`';
        }

        try {
          const info = await pluginLoader.enable(pluginName);
          if (info.state === 'loaded') {
            return `Plugin **${pluginName}** enabled.`;
          }
          return `Failed to enable **${pluginName}**: ${info.error || 'Unknown error'}`;
        } catch (error) {
          return `Error enabling **${pluginName}**: ${error}`;
        }
      }

      if (subCommand === 'disable') {
        if (!pluginName) {
          return 'Please specify a plugin name. Usage: `!plugins disable <name>`';
        }

        const success = await pluginLoader.disable(pluginName);
        if (success) {
          return `Plugin **${pluginName}** disabled.`;
        }
        return `Failed to disable **${pluginName}**. Plugin may not be loaded.`;
      }

      return [
        '**Plugin Commands:**',
        '• `!plugins` - List all plugins',
        '• `!plugins reload <name|all>` - Hot reload plugin(s)',
        '• `!plugins enable <name>` - Enable a plugin',
        '• `!plugins disable <name>` - Disable a plugin',
      ].join('\n');
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
