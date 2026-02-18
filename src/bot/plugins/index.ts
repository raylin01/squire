/**
 * Squire Plugin System
 *
 * Allows Squire to write, load, and manage its own Discord.js plugins.
 * Plugins have full access to Discord.js client and can be:
 * - Enabled/disabled individually
 * - Disabled en masse in "safe mode"
 * - Hot reloaded without restart
 */

export { PluginLoader, createPluginLoader, type PluginLoaderOptions } from './loader.js';
export type {
  SquirePlugin,
  PluginContext,
  PluginState,
  PluginInfo,
  WorkspaceSource,
} from './types.js';
