/**
 * Squire Plugin System
 *
 * Allows Squire to write, load, and manage its own Discord.js plugins.
 * Plugins have full access to Discord.js client and can be:
 * - Enabled/disabled individually
 * - Disabled en masse in "safe mode"
 * - Hot reloaded without restart
 */

import type { PluginLoader } from './loader.js';

// Global plugin loader reference for commands and other modules
let _pluginLoader: PluginLoader | null = null;

/**
 * Set the global plugin loader reference
 */
export function setPluginLoader(loader: PluginLoader): void {
  _pluginLoader = loader;
}

/**
 * Get the global plugin loader reference
 */
export function getPluginLoader(): PluginLoader | null {
  return _pluginLoader;
}

export { PluginLoader, createPluginLoader, type PluginLoaderOptions } from './loader.js';
export type {
  SquirePlugin,
  PluginContext,
  PluginState,
  PluginInfo,
  WorkspaceSource,
} from './types.js';
