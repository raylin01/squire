/**
 * SquireBot Configuration
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

  // WebSocket Server
  wsPort: number;
  wsHost: string;

  // Authentication
  runnerToken: string;  // Token that runner-agent must provide

  // Behavior
  allowedGuilds?: string[];
  allowedUsers?: string[];

  // Forum configuration
  forums?: Record<string, ForumConfig>;
}

export interface ForumConfig {
  guildId: string;
  channelId: string;
  tagConfig: {
    bugTagId: string;
    featureTagId: string;
    questionTagId: string;
    taskTagId: string;
    statusTags: Record<string, string>;
    priorityTags: Record<string, string>;
    assigneeTags: Record<string, string>;
  };
}

const DEFAULT_CONFIG: Partial<SquireBotConfig> = {
  wsPort: 3123,
  wsHost: '0.0.0.0',
  runnerToken: '',
};

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
    const fileConfig = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...fileConfig } as SquireBotConfig;
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
  discordAppId: string,
  runnerToken?: string
): SquireBotConfig {
  const config: SquireBotConfig = {
    discordToken,
    discordAppId,
    wsPort: 3123,
    wsHost: '0.0.0.0',
    runnerToken: runnerToken || generateToken(),
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

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
