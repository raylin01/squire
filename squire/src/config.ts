/**
 * Squire Configuration Management
 *
 * Handles loading, saving, and merging configuration from various sources.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SquireConfig, MemoryConfig, SkillsConfig, PermissionConfig } from './types.js';

const SQUIRE_DIR = path.join(os.homedir(), '.squire');
const CONFIG_FILE = path.join(SQUIRE_DIR, 'config.json');
const DATA_DIR = path.join(SQUIRE_DIR, 'data');

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Omit<SquireConfig, 'squireId'> = {
  name: 'Squire',
  dataDir: DATA_DIR,
  memoryDbPath: path.join(DATA_DIR, 'memory.db'),
  skillsDir: path.join(DATA_DIR, 'skills'),
  model: 'claude-sonnet-4-20250514',
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
  permissions: {
    mode: 'confirm',
    allowedTools: [],
    blockedTools: [],
  },
};

/**
 * Deep merge utility for nested config objects
 */
function deepMergeObjects<T extends object>(base: T, override: Partial<T> | undefined): T {
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
  if (!fs.existsSync(SQUIRE_DIR)) {
    fs.mkdirSync(SQUIRE_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const skillsDir = path.join(DATA_DIR, 'skills');
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
}

/**
 * Load configuration from file
 */
export function loadConfig(): SquireConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const fileConfig = JSON.parse(content);
    return resolveConfig(fileConfig);
  } catch (error) {
    console.error(`[Squire] Error loading config: ${error}`);
    return null;
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: SquireConfig): void {
  ensureSquireDir();

  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

/**
 * Resolve partial config to full config with defaults
 */
export function resolveConfig(partial: Partial<SquireConfig> & { squireId: string }): SquireConfig {
  const dataDir = partial.dataDir || DEFAULT_CONFIG.dataDir;

  const config: SquireConfig = {
    squireId: partial.squireId,
    name: partial.name || DEFAULT_CONFIG.name,
    dataDir,
    memoryDbPath: partial.memoryDbPath || path.join(dataDir, 'memory.db'),
    skillsDir: partial.skillsDir || path.join(dataDir, 'skills'),
    model: partial.model || DEFAULT_CONFIG.model,
    fallbackModel: partial.fallbackModel,
    daemonMode: partial.daemonMode ?? DEFAULT_CONFIG.daemonMode,
    pollInterval: partial.pollInterval ?? DEFAULT_CONFIG.pollInterval,
    memory: deepMergeObjects(DEFAULT_CONFIG.memory, partial.memory),
    skills: deepMergeObjects(DEFAULT_CONFIG.skills, partial.skills),
    permissions: deepMergeObjects(DEFAULT_CONFIG.permissions, partial.permissions),
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
    ...DEFAULT_CONFIG,
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
  console.log(`[Squire] Config initialized at ${CONFIG_FILE}`);

  return config;
}

/**
 * Get the path to the Squire config directory
 */
export function getSquireDir(): string {
  return SQUIRE_DIR;
}

/**
 * Get the path to the Squire data directory
 */
export function getDataDir(): string {
  return DATA_DIR;
}

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
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

  if (!config.model) {
    errors.push('model is required');
  }

  if (config.pollInterval < 1000) {
    errors.push('pollInterval must be at least 1000ms');
  }

  if (!['trust', 'confirm', 'ask'].includes(config.permissions.mode)) {
    errors.push('permissions.mode must be trust, confirm, or ask');
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

  if (process.env.SQUIRE_MODEL) {
    envConfig.model = process.env.SQUIRE_MODEL;
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

  return Object.keys(envConfig).length > 0 ? { ...config, ...envConfig } : config;
}
