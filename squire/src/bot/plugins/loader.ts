/**
 * Plugin Loader
 *
 * Discovers, loads, and manages plugins.
 * Supports safe mode, enable/disable, hot reload.
 */

import fs from 'fs';
import path from 'path';
import type { Client, TextChannel, DMChannel, ThreadChannel } from 'discord.js';
import type { Squire } from '../../index.js';
import type { SquirePlugin, PluginContext, PluginState, PluginInfo, WorkspaceSource } from './types.js';

export interface PluginLoaderOptions {
  pluginsDir: string;          // Directory containing plugins
  client: Client;              // Discord.js client
  squireId: string;
  squireName: string;
  squire: Squire;              // Squire instance for AI communication
  safeMode?: boolean;          // Disable all plugins when true
  autoEnable?: boolean;        // Auto-enable new plugins
  config?: Record<string, any>; // Bot config (read-only for plugins)
  getOrCreateWorkspace?: (channelId: string, channelName: string, source: WorkspaceSource) => Promise<string>;
  registerChannel?: (workspaceId: string, channel: TextChannel | DMChannel | ThreadChannel) => void;
}

export class PluginLoader {
  private pluginsDir: string;
  private client: Client;
  private squireId: string;
  private squireName: string;
  private squire: Squire;
  private safeMode: boolean;
  private autoEnable: boolean;
  private config: Record<string, any>;
  private getOrCreateWorkspaceFn?: (channelId: string, channelName: string, source: WorkspaceSource) => Promise<string>;
  private registerChannelFn?: (workspaceId: string, channel: TextChannel | DMChannel | ThreadChannel) => void;

  private plugins: Map<string, PluginInfo> = new Map();
  private pluginStates: Map<string, Record<string, any>> = new Map();

  constructor(options: PluginLoaderOptions) {
    this.pluginsDir = options.pluginsDir;
    this.client = options.client;
    this.squireId = options.squireId;
    this.squireName = options.squireName;
    this.squire = options.squire;
    this.safeMode = options.safeMode ?? false;
    this.autoEnable = options.autoEnable ?? true;
    this.config = options.config || {};
    this.getOrCreateWorkspaceFn = options.getOrCreateWorkspace;
    this.registerChannelFn = options.registerChannel;
  }

  /**
   * Discover all plugins in the plugins directory
   */
  async discover(): Promise<string[]> {
    const discovered: string[] = [];

    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return discovered;
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginPath = path.join(this.pluginsDir, entry.name);

      // Check for plugin files
      const hasPlugin =
        fs.existsSync(path.join(pluginPath, 'index.js')) ||
        fs.existsSync(path.join(pluginPath, 'index.ts')) ||
        fs.existsSync(path.join(pluginPath, 'plugin.js')) ||
        fs.existsSync(path.join(pluginPath, 'plugin.ts'));

      if (hasPlugin) {
        discovered.push(entry.name);
      }
    }

    return discovered;
  }

  /**
   * Load all discovered plugins
   */
  async loadAll(): Promise<Map<string, PluginInfo>> {
    const discovered = await this.discover();

    // Sort by priority (if specified)
    const pluginData: Array<{ name: string; priority: number }> = [];

    for (const name of discovered) {
      try {
        const info = await this.loadPluginInfo(name);
        pluginData.push({
          name,
          priority: info.plugin.priority ?? 0
        });
      } catch {
        pluginData.push({ name, priority: 0 });
      }
    }

    // Sort by priority (lower = load first)
    pluginData.sort((a, b) => a.priority - b.priority);

    // Load in order
    for (const { name } of pluginData) {
      await this.load(name);
    }

    return this.plugins;
  }

  /**
   * Load plugin info without fully loading
   */
  private async loadPluginInfo(name: string): Promise<PluginInfo> {
    const pluginPath = path.join(this.pluginsDir, name);

    // Try to load the plugin module
    let plugin: SquirePlugin;

    const indexPaths = [
      path.join(pluginPath, 'index.js'),
      path.join(pluginPath, 'index.ts'),
      path.join(pluginPath, 'plugin.js'),
      path.join(pluginPath, 'plugin.ts'),
    ];

    let loadedPath: string | undefined;
    for (const ip of indexPaths) {
      if (fs.existsSync(ip)) {
        loadedPath = ip;
        break;
      }
    }

    if (!loadedPath) {
      throw new Error(`No plugin file found for ${name}`);
    }

    try {
      // Dynamic import
      const module = await import(loadedPath);
      plugin = module.default || module.plugin;

      if (!plugin || !plugin.name) {
        throw new Error('Invalid plugin: missing name');
      }
    } catch (error) {
      throw new Error(`Failed to load plugin: ${error}`);
    }

    return {
      plugin,
      path: pluginPath,
      state: 'not_found',
    };
  }

  /**
   * Load a single plugin
   */
  async load(name: string): Promise<PluginInfo> {
    // Check if already loaded
    const existing = this.plugins.get(name);
    if (existing && existing.state === 'loaded') {
      return existing;
    }

    // Check safe mode
    if (this.safeMode) {
      const info: PluginInfo = {
        plugin: { name, version: '0.0.0' },
        path: path.join(this.pluginsDir, name),
        state: 'disabled',
        error: 'Safe mode enabled',
      };
      this.plugins.set(name, info);
      return info;
    }

    try {
      const info = await this.loadPluginInfo(name);
      info.state = 'loading';

      // Check if plugin is disabled
      if (info.plugin.enabled === false) {
        info.state = 'disabled';
        this.plugins.set(name, info);
        return info;
      }

      // Check dependencies
      if (info.plugin.dependencies) {
        for (const dep of info.plugin.dependencies) {
          const depInfo = this.plugins.get(dep);
          if (!depInfo || depInfo.state !== 'loaded') {
            info.state = 'error';
            info.error = `Missing dependency: ${dep}`;
            this.plugins.set(name, info);
            return info;
          }
        }
      }

      // Create context
      const context = this.createContext(name, info.path);

      // Call onLoad
      if (info.plugin.onLoad) {
        await info.plugin.onLoad(context);
      }

      // Call setup with Discord client
      if (info.plugin.setup) {
        await info.plugin.setup(this.client, context);
      }

      info.state = 'loaded';
      info.loadedAt = new Date();
      this.plugins.set(name, info);

      console.log(`[Plugins] Loaded: ${name} v${info.plugin.version}`);
      return info;

    } catch (error) {
      const info: PluginInfo = {
        plugin: { name, version: '0.0.0' },
        path: path.join(this.pluginsDir, name),
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      this.plugins.set(name, info);
      console.error(`[Plugins] Failed to load ${name}:`, error);
      return info;
    }
  }

  /**
   * Unload a plugin
   */
  async unload(name: string): Promise<boolean> {
    const info = this.plugins.get(name);
    if (!info || info.state !== 'loaded') {
      return false;
    }

    try {
      // Call onUnload
      if (info.plugin.onUnload) {
        await info.plugin.onUnload();
      }

      info.state = 'disabled';
      console.log(`[Plugins] Unloaded: ${name}`);
      return true;

    } catch (error) {
      console.error(`[Plugins] Error unloading ${name}:`, error);
      return false;
    }
  }

  /**
   * Reload a plugin
   */
  async reload(name: string): Promise<PluginInfo> {
    await this.unload(name);

    // Clear from cache
    const pluginPath = path.join(this.pluginsDir, name);
    const cacheKey = require.resolve?.(pluginPath);
    if (cacheKey && require.cache[cacheKey]) {
      delete require.cache[cacheKey];
    }

    this.plugins.delete(name);
    return this.load(name);
  }

  /**
   * Enable a disabled plugin
   */
  async enable(name: string): Promise<PluginInfo> {
    const info = this.plugins.get(name);
    if (!info) {
      // Try to load
      return this.load(name);
    }

    if (info.state === 'loaded') {
      return info;
    }

    info.plugin.enabled = true;
    return this.load(name);
  }

  /**
   * Disable a loaded plugin
   */
  async disable(name: string): Promise<boolean> {
    const info = this.plugins.get(name);
    if (!info) return false;

    if (info.state === 'loaded') {
      await this.unload(name);
    }

    info.plugin.enabled = false;
    info.state = 'disabled';
    return true;
  }

  /**
   * Enter safe mode (disable all plugins)
   */
  async enterSafeMode(): Promise<void> {
    this.safeMode = true;

    for (const [name, info] of this.plugins) {
      if (info.state === 'loaded') {
        await this.unload(name);
        info.state = 'disabled';
        info.error = 'Safe mode enabled';
      }
    }

    console.log('[Plugins] Entered safe mode - all plugins disabled');
  }

  /**
   * Exit safe mode
   */
  async exitSafeMode(): Promise<void> {
    this.safeMode = false;
    console.log('[Plugins] Exited safe mode - use loadAll() to re-enable plugins');
  }

  /**
   * Check if in safe mode
   */
  isSafeMode(): boolean {
    return this.safeMode;
  }

  /**
   * Get all plugins
   */
  getAll(): Map<string, PluginInfo> {
    return new Map(this.plugins);
  }

  /**
   * Get a specific plugin
   */
  get(name: string): PluginInfo | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get plugin state
   */
  getState(name: string): PluginState {
    const info = this.plugins.get(name);
    return info?.state ?? 'not_found';
  }

  /**
   * Create plugin context
   */
  private createContext(name: string, pluginDir: string): PluginContext {
    const self = this;

    return {
      pluginDir,
      pluginName: name,
      client: this.client,
      squireId: this.squireId,
      squireName: this.squireName,
      squire: this.squire,

      // Workspace management
      getOrCreateWorkspace: async (channelId: string, channelName: string, source: WorkspaceSource) => {
        if (!self.getOrCreateWorkspaceFn) {
          throw new Error('Workspace management not configured');
        }
        return self.getOrCreateWorkspaceFn(channelId, channelName, source);
      },

      registerChannel: (workspaceId: string, channel: TextChannel | DMChannel | ThreadChannel) => {
        if (!self.registerChannelFn) {
          throw new Error('Channel registration not configured');
        }
        self.registerChannelFn(workspaceId, channel);
      },

      // Config (read-only)
      config: this.config,

      log: (...args: any[]) => {
        console.log(`[${name}]`, ...args);
      },

      error: (...args: any[]) => {
        console.error(`[${name}]`, ...args);
      },

      disablePlugin: async (pluginName: string) => {
        await self.disable(pluginName);
      },

      enablePlugin: async (pluginName: string) => {
        await self.enable(pluginName);
      },

      getState: <T = any>(key: string): T | undefined => {
        const state = self.pluginStates.get(name);
        return state?.[key] as T | undefined;
      },

      setState: <T = any>(key: string, value: T): void => {
        let state = self.pluginStates.get(name);
        if (!state) {
          state = {};
          self.pluginStates.set(name, state);
        }
        state[key] = value;
      },

      getPlugin: (pluginName: string): SquirePlugin | undefined => {
        return self.plugins.get(pluginName)?.plugin;
      },

      getPluginState: (pluginName: string): PluginState => {
        return self.getState(pluginName);
      },
    };
  }
}

/**
 * Create a plugin loader
 */
export function createPluginLoader(options: PluginLoaderOptions): PluginLoader {
  return new PluginLoader(options);
}
