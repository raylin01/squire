/**
 * SquireBot Configuration
 *
 * Configuration for the Discord bot that interfaces with Squire core.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SQUIREBOT_DIR = path.join(os.homedir(), '.squirebot');
const CONFIG_FILE = path.join(SQUIREBOT_DIR, 'config.json');

export interface SquireBotConfig {
  // Discord
  discordToken: string;
  discordAppId: string;

  // Squire core settings
  squire?: {
    provider?: 'claude' | 'gemini' | 'codex';
    model?: string;
    permissionMode?: 'strict' | 'autoSafe' | 'permissive';
  };

  // Behavior
  allowedGuilds?: string[];
  allowedUsers?: string[];

  // Forum configuration
  forums?: Record<string, ForumConfig>;

  // Plugin system
  plugins?: PluginConfig;
}

export interface PluginConfig {
  // Enable safe mode (disable all plugins)
  safeMode?: boolean;

  // Auto-enable newly discovered plugins
  autoEnable?: boolean;

  // Explicitly disabled plugins (by name)
  disabled?: string[];

  // Explicitly enabled plugins (by name)
  enabled?: string[];

  // Custom plugins directory (default: ~/.squirebot/plugins)
  pluginsDir?: string;
}

export interface ForumConfig {
  guildId: string;
  channelId: string;
  tagConfig?: {
    bugTagId?: string;
    featureTagId?: string;
    questionTagId?: string;
    taskTagId?: string;
    statusTags?: Record<string, string>;
    priorityTags?: Record<string, string>;
    assigneeTags?: Record<string, string>;
  };
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(SQUIREBOT_DIR)) {
    fs.mkdirSync(SQUIREBOT_DIR, { recursive: true });
  }
}

export function loadConfig(): SquireBotConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as SquireBotConfig;
  } catch (error) {
    console.error(`[SquireBot] Error loading config: ${error}`);
    return null;
  }
}

export function saveConfig(config: SquireBotConfig): void {
  ensureConfigDir();
  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

export function createDefaultConfig(
  discordToken: string,
  discordAppId: string
): SquireBotConfig {
  const config: SquireBotConfig = {
    discordToken,
    discordAppId,
    squire: {
      provider: 'claude',
      permissionMode: 'autoSafe',
    },
    plugins: {
      safeMode: false,
      autoEnable: true,
      disabled: [],
      enabled: [],
    },
  };

  saveConfig(config);
  return config;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getSquireBotDir(): string {
  return SQUIREBOT_DIR;
}
