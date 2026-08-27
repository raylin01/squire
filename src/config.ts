/**
 * Squire Configuration Management
 *
 * Handles loading, saving, and merging configuration from various sources.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SquireConfig, MemoryConfig, SkillsConfig, ToolsConfig, PermissionConfig, PersonalityConfig, SDKConfig } from './types.js';

const SQUIRE_DIR_DEFAULT = path.join(os.homedir(), '.squire');

export function getSquireDir(): string {
  const fromEnv = process.env.SQUIRE_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return SQUIRE_DIR_DEFAULT;
}

export function getDataDir(): string {
  return path.join(getSquireDir(), 'data');
}

export function getConfigPath(): string {
  return path.join(getSquireDir(), 'config.json');
}

export function getToolsDir(): string {
  return path.join(getSquireDir(), 'tools');
}

function getBotConfigPathForSync(): string | null {
  const botDir = process.env.SQUIREBOT_DIR?.trim();
  if (botDir) {
    return path.join(path.resolve(botDir), 'config.json');
  }
  // Isolated core config must not rewrite the production Discord bot config.
  if (process.env.SQUIRE_DIR?.trim()) {
    return null;
  }
  return path.join(os.homedir(), '.squirebot', 'config.json');
}

/**
 * Default personality configuration
 */
const DEFAULT_PERSONALITY: PersonalityConfig['default'] = {
  name: 'Helpful Assistant',
  description: 'A friendly, balanced assistant that provides helpful responses with moderate detail.',
  traits: {
    tone: 'friendly',
    verbosity: 'balanced',
    technicality: 'moderate',
    enthusiasm: 'enthusiastic',
    humor: 'subtle',
  },
};

/**
 * Default configuration values (paths resolved at call time so SQUIRE_DIR works)
 */
function defaultConfig(): Omit<SquireConfig, 'squireId'> {
  const dataDir = getDataDir();
  return {
    name: 'Squire',
    dataDir,
    memoryDbPath: path.join(dataDir, 'memory.db'),
    skillsDir: path.join(dataDir, 'skills'),
    sdk: {
      provider: 'gemini',
    },
    daemonMode: false,
    pollInterval: 60000,
    memory: {
      enabled: true,
      provider: 'qmd',
      enableReranking: true,
      retentionDays: 90,
    },
    skills: {
      bundled: ['memory', 'web'],
      additional: [],
      autoInstall: true,
    },
    tools: {
      globalDir: getToolsDir(),
      projectDir: '.squire/tools',
      autoInstall: true,
      searchEnabled: true,
    },
    personality: {
      default: DEFAULT_PERSONALITY,
      workspaceOverrides: {},
    },
    permissions: {
      mode: 'autoSafe',
      allowedTools: [],
      blockedTools: [],
    },
  };
}

/**
 * Deep merge utility for nested config objects
 */
export function deepMergeObjects<T extends object>(base: T, override: Partial<T> | undefined): T {
  if (!override) return base;

  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideVal = override[key];
    const baseVal = base[key];

    if (
      overrideVal !== undefined &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal) &&
      baseVal !== undefined &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMergeObjects(
        baseVal as object,
        overrideVal as Partial<object>
      );
    } else if (overrideVal !== undefined) {
      (result as Record<string, unknown>)[key as string] = overrideVal;
    }
  }
  return result;
}

/**
 * Ensure the Squire directory structure exists
 */
export function ensureSquireDir(): void {
  const squireDir = getSquireDir();
  const dataDir = getDataDir();
  const toolsDir = getToolsDir();

  if (!fs.existsSync(squireDir)) {
    fs.mkdirSync(squireDir, { recursive: true });
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const skillsDir = path.join(dataDir, 'skills');
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }
}

/**
 * Load configuration from file
 */
export function loadConfig(): SquireConfig | null {
  const configFile = getConfigPath();
  if (!fs.existsSync(configFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configFile, 'utf-8');
    const fileConfig = JSON.parse(content);
    return resolveConfig(fileConfig);
  } catch (error) {
    console.error(`[Squire] Error loading config: ${error}`);
    return null;
  }
}

/**
 * When the in-process Discord bot is in use, keep overlapping identity and SDK
 * settings in ~/.squirebot/config.json so a restart does not drop them.
 */
function syncOverlappingSettingsToBotConfig(config: SquireConfig): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test' || process.env.SQUIRE_SYNC_BOT_CONFIG === '0') {
    return;
  }
  const botConfigPath = getBotConfigPathForSync();
  if (!botConfigPath || !fs.existsSync(botConfigPath)) {
    return;
  }

  try {
    const botConfig = JSON.parse(fs.readFileSync(botConfigPath, 'utf-8')) as Record<string, unknown>;
    const existingSquire = (botConfig.squire && typeof botConfig.squire === 'object')
      ? botConfig.squire as Record<string, unknown>
      : {};
    botConfig.squireId = config.squireId;
    botConfig.name = config.name;
    botConfig.squire = {
      ...existingSquire,
      provider: config.sdk.provider,
      model: config.sdk.model,
      cliPath: config.sdk.cliPath,
      permissionMode: config.permissions.mode,
    };
    fs.writeFileSync(botConfigPath, JSON.stringify(botConfig, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[Squire] Could not sync settings to ${botConfigPath}: ${error}`);
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: SquireConfig): void {
  ensureSquireDir();

  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(getConfigPath(), content, 'utf-8');
  syncOverlappingSettingsToBotConfig(config);
}

/**
 * Resolve partial config to full config with defaults
 */
export function resolveConfig(partial: Partial<SquireConfig> & { squireId: string }): SquireConfig {
  const defaults = defaultConfig();
  const dataDir = partial.dataDir || defaults.dataDir;

  const config: SquireConfig = {
    squireId: partial.squireId,
    name: partial.name || defaults.name,
    dataDir,
    memoryDbPath: partial.memoryDbPath || path.join(dataDir, 'memory.db'),
    skillsDir: partial.skillsDir || path.join(dataDir, 'skills'),
    sdk: deepMergeObjects(defaults.sdk, partial.sdk),
    model: partial.model,
    fallbackModel: partial.fallbackModel,
    daemonMode: partial.daemonMode ?? defaults.daemonMode,
    pollInterval: partial.pollInterval ?? defaults.pollInterval,
    memory: deepMergeObjects(defaults.memory, partial.memory),
    skills: deepMergeObjects(defaults.skills, partial.skills),
    tools: deepMergeObjects(defaults.tools, partial.tools),
    personality: deepMergeObjects(defaults.personality, partial.personality),
    permissions: deepMergeObjects(defaults.permissions, partial.permissions),
  };

  return config;
}

/**
 * Create a default configuration
 */
export function createDefaultConfig(squireId?: string): SquireConfig {
  ensureSquireDir();

  const config: SquireConfig = {
    squireId: squireId || `squire-${Date.now()}`,
    ...defaultConfig(),
  };

  return config;
}

/**
 * Initialize configuration interactively or with options
 */
export function initConfig(options?: {
  squireId?: string;
  name?: string;
  daemonMode?: boolean;
  memoryProvider?: MemoryConfig['provider'];
  permissionMode?: PermissionConfig['mode'];
}): SquireConfig {
  ensureSquireDir();

  const memoryPartial = options?.memoryProvider
    ? { enabled: true, provider: options.memoryProvider, retentionDays: 90 }
    : undefined;

  const permissionsPartial = options?.permissionMode
    ? { mode: options.permissionMode, allowedTools: [], blockedTools: [] }
    : undefined;

  const config = resolveConfig({
    squireId: options?.squireId || `squire-${Date.now()}`,
    name: options?.name,
    daemonMode: options?.daemonMode,
    memory: memoryPartial,
    permissions: permissionsPartial,
  });

  saveConfig(config);
  console.log(`[Squire] Config initialized at ${getConfigPath()}`);

  return config;
}

/**
 * Get the default personality
 */
export function getDefaultPersonality(): PersonalityConfig['default'] {
  return DEFAULT_PERSONALITY;
}

/**
 * Validate configuration
 */
export function validateConfig(config: SquireConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.squireId) {
    errors.push('squireId is required');
  }

  if (!config.name || config.name.trim() === '') {
    errors.push('name is required');
  }

  if (!config.sdk?.provider) {
    errors.push('sdk.provider is required');
  }

  if (!['claude', 'gemini', 'codex'].includes(config.sdk?.provider)) {
    errors.push('sdk.provider must be claude, gemini, or codex');
  }

  if (config.pollInterval < 1000) {
    errors.push('pollInterval must be at least 1000ms');
  }

  if (!['strict', 'autoSafe', 'permissive'].includes(config.permissions.mode)) {
    errors.push('permissions.mode must be strict, autoSafe, or permissive');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge environment variables into config
 */
export function mergeEnvConfig(config: SquireConfig): SquireConfig {
  const envConfig: Partial<SquireConfig> = {};

  if (process.env.SQUIRE_NAME) {
    envConfig.name = process.env.SQUIRE_NAME;
  }

  if (process.env.SQUIRE_SDK_PROVIDER) {
    envConfig.sdk = {
      ...(config.sdk || {}),
      provider: process.env.SQUIRE_SDK_PROVIDER as SDKConfig['provider'],
    };
  }

  if (process.env.SQUIRE_SDK_MODEL) {
    envConfig.sdk = {
      ...(config.sdk || {}),
      provider: config.sdk?.provider || 'gemini',
      model: process.env.SQUIRE_SDK_MODEL,
    };
  }

  if (process.env.SQUIRE_DAEMON) {
    envConfig.daemonMode = process.env.SQUIRE_DAEMON === 'true';
  }

  if (process.env.SQUIRE_DATA_DIR) {
    envConfig.dataDir = process.env.SQUIRE_DATA_DIR;
    envConfig.memoryDbPath = path.join(process.env.SQUIRE_DATA_DIR, 'memory.db');
    envConfig.skillsDir = path.join(process.env.SQUIRE_DATA_DIR, 'skills');
  }

  if (process.env.SQUIRE_PERMISSION_MODE) {
    envConfig.permissions = {
      mode: process.env.SQUIRE_PERMISSION_MODE as PermissionConfig['mode'],
      allowedTools: [],
      blockedTools: [],
    };
  }

  return Object.keys(envConfig).length > 0 ? deepMergeObjects(config, envConfig) : config;
}
