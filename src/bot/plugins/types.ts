/**
 * Squire Plugin System
 *
 * Minimal plugin loader with:
 * - Direct Discord.js access
 * - Enable/disable support
 * - Safe mode
 * - Hot reload
 */

import type { Client, TextChannel, DMChannel, ThreadChannel } from 'discord.js';
import type { Squire } from '../../index.js';

/**
 * Plugin manifest - defines what the plugin does
 */
export interface SquirePlugin {
  // Identity
  name: string;
  version: string;
  description?: string;
  author?: string;

  // Lifecycle hooks
  onLoad?: (context: PluginContext) => Promise<void> | void;
  onUnload?: () => Promise<void> | void;

  // Discord.js hooks - direct access
  setup?: (client: Client, context: PluginContext) => Promise<void> | void;

  // Optional metadata
  enabled?: boolean;  // Default true
  priority?: number;  // Load order (higher = later)
  dependencies?: string[];  // Other plugins required
}

/**
 * Workspace source type
 */
export type WorkspaceSource = 'discord_dm' | 'discord_channel' | 'discord_forum';

/**
 * Context provided to plugins
 */
export interface PluginContext {
  // Plugin info
  pluginDir: string;
  pluginName: string;

  // Discord client (full access)
  client: Client;

  // Squire integration
  squireId: string;
  squireName: string;
  squire: Squire;

  // Workspace management
  getOrCreateWorkspace: (channelId: string, channelName: string, source: WorkspaceSource) => Promise<string>;
  registerChannel: (workspaceId: string, channel: TextChannel | DMChannel | ThreadChannel) => void;

  // Utilities
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;

  // Plugin control
  disablePlugin: (name: string) => Promise<void>;
  enablePlugin: (name: string) => Promise<void>;

  // State (persisted per-plugin)
  getState: <T = any>(key: string) => T | undefined;
  setState: <T = any>(key: string, value: T) => void;

  // Config access (read-only)
  config: Record<string, any>;

  // Other plugins
  getPlugin: (name: string) => SquirePlugin | undefined;
  getPluginState: (name: string) => PluginState;
}

/**
 * Plugin state
 */
export type PluginState = 'loaded' | 'disabled' | 'error' | 'loading' | 'not_found';

/**
 * Tracked plugin info
 */
export interface PluginInfo {
  plugin: SquirePlugin;
  path: string;
  state: PluginState;
  error?: string;
  loadedAt?: Date;
}
