/**
 * Squire Plugin Tools
 *
 * Tools for creating and managing Squire plugins.
 */

import { defineTool } from './registry.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Get the plugins directory
 */
function getPluginsDir(): string {
  return path.join(os.homedir(), '.squirebot', 'plugins');
}

/**
 * Create a plugin directory and file
 */
defineTool(
  'plugin_create',
  `Create a new Squire plugin for extending Discord bot functionality.

WHEN TO USE:
- User wants to add custom Discord bot features
- User wants to react to Discord events (messages, reactions, etc.)
- User wants to add custom commands or behaviors
- User wants to integrate external services with the bot

PLUGIN STRUCTURE:
- Plugins are JavaScript files in ~/.squirebot/plugins/<name>/index.js
- Plugins have access to Discord.js client and Squire context
- Plugins can be hot-reloaded without restarting the bot

IMPORTANT:
- Use context.require() for external modules like discord.js
- The client is already provided - no need to import discord.js directly
- See PLUGINS.md in the Squire repository for full documentation`,
  {
    name: {
      type: 'string',
      description: 'Plugin name (kebab-case, e.g., "reaction-roles")',
    },
    description: {
      type: 'string',
      description: 'What the plugin does',
    },
    code: {
      type: 'string',
      description: 'The plugin JavaScript code (export default { ... })',
    },
  },
  ['name', 'description', 'code'],
  async (input) => {
    const name = input.name as string;
    const description = input.description as string;
    const code = input.code as string;

    // Validate name
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
      return JSON.stringify({
        success: false,
        error: 'Plugin name must be kebab-case (lowercase letters, numbers, hyphens)',
      }, null, 2);
    }

    const pluginsDir = getPluginsDir();
    const pluginDir = path.join(pluginsDir, name);
    const pluginFile = path.join(pluginDir, 'index.js');

    try {
      // Create plugin directory
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }

      // Check if plugin already exists
      if (fs.existsSync(pluginFile)) {
        return JSON.stringify({
          success: false,
          error: `Plugin "${name}" already exists. Use plugin_update to modify it.`,
          path: pluginFile,
        }, null, 2);
      }

      // Write plugin file
      fs.writeFileSync(pluginFile, code, 'utf-8');

      return JSON.stringify({
        success: true,
        message: `Plugin "${name}" created successfully`,
        path: pluginFile,
        hint: `Use !plugins reload ${name} to load the plugin without restarting the bot`,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to create plugin: ${error}`,
      }, null, 2);
    }
  }
);

/**
 * Update an existing plugin
 */
defineTool(
  'plugin_update',
  `Update an existing Squire plugin's code.

WHEN TO USE:
- Modifying an existing plugin's behavior
- Fixing bugs in a plugin
- Adding new features to a plugin

The plugin will need to be reloaded with !plugins reload <name> after updating.`,
  {
    name: {
      type: 'string',
      description: 'Plugin name to update',
    },
    code: {
      type: 'string',
      description: 'The new plugin JavaScript code',
    },
  },
  ['name', 'code'],
  async (input) => {
    const name = input.name as string;
    const code = input.code as string;

    const pluginsDir = getPluginsDir();
    const pluginFile = path.join(pluginsDir, name, 'index.js');

    try {
      if (!fs.existsSync(pluginFile)) {
        return JSON.stringify({
          success: false,
          error: `Plugin "${name}" not found`,
        }, null, 2);
      }

      // Update plugin file
      fs.writeFileSync(pluginFile, code, 'utf-8');

      return JSON.stringify({
        success: true,
        message: `Plugin "${name}" updated`,
        path: pluginFile,
        hint: `Use !plugins reload ${name} to apply changes without restarting the bot`,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to update plugin: ${error}`,
      }, null, 2);
    }
  }
);

/**
 * Read a plugin's code
 */
defineTool(
  'plugin_read',
  `Read a plugin's source code.

WHEN TO USE:
- Debugging a plugin
- Understanding how a plugin works
- Before modifying a plugin`,
  {
    name: {
      type: 'string',
      description: 'Plugin name to read',
    },
  },
  ['name'],
  async (input) => {
    const name = input.name as string;

    const pluginsDir = getPluginsDir();
    const pluginFile = path.join(pluginsDir, name, 'index.js');

    try {
      if (!fs.existsSync(pluginFile)) {
        return JSON.stringify({
          success: false,
          error: `Plugin "${name}" not found`,
          pluginsDir,
        }, null, 2);
      }

      const code = fs.readFileSync(pluginFile, 'utf-8');

      return JSON.stringify({
        success: true,
        name,
        path: pluginFile,
        code,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to read plugin: ${error}`,
      }, null, 2);
    }
  }
);

/**
 * List all plugins
 */
defineTool(
  'plugin_list',
  `List all installed plugins and their status.

WHEN TO USE:
- Seeing what plugins are available
- Checking plugin status (loaded, disabled, error)
- Finding plugin names for other operations`,
  {},
  [],
  async () => {
    const pluginsDir = getPluginsDir();

    try {
      if (!fs.existsSync(pluginsDir)) {
        return JSON.stringify({
          success: true,
          plugins: [],
          message: 'No plugins directory found. Create plugins in ~/.squirebot/plugins/',
        }, null, 2);
      }

      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      const plugins: Array<{ name: string; path: string; hasIndex: boolean }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = path.join(pluginsDir, entry.name);
        const hasIndex = fs.existsSync(path.join(pluginPath, 'index.js')) ||
          fs.existsSync(path.join(pluginPath, 'plugin.js'));

        plugins.push({
          name: entry.name,
          path: pluginPath,
          hasIndex,
        });
      }

      return JSON.stringify({
        success: true,
        plugins,
        pluginsDir,
        hint: 'Use !plugins in Discord to see loading status and manage plugins',
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to list plugins: ${error}`,
      }, null, 2);
    }
  }
);
