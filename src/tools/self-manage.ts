/**
 * Squire Self-Management Tools
 *
 * Tools that allow Squire to manage itself - restart, change config, switch SDK, etc.
 */

import { defineTool } from './registry.js';
import { sendEmbed } from './communicate.js';

// Self-management state - set by Squire instance
interface SelfManageState {
  restart: () => Promise<void>;
  switchSDK: (provider: 'claude' | 'gemini' | 'codex') => Promise<void>;
  switchModel: (model: string) => Promise<void>;
  updateConfig: (updates: Record<string, unknown>) => Promise<void>;
  reloadSkills: () => Promise<void>;
  getConfig: () => Record<string, unknown>;
}

let selfManageState: SelfManageState | null = null;

/**
 * Set the self-management state handlers.
 * Called by Squire to connect these tools to actual functionality.
 */
export function setSelfManageState(state: SelfManageState): void {
  selfManageState = state;
}

// squire_restart - Restart Squire
defineTool(
  'squire_restart',
  'Restart Squire. Use this when things seem stuck or after major configuration changes.',
  {
    reason: {
      type: 'string',
      description: 'Optional reason for restart',
    },
  },
  [],
  async (input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    const reason = input.reason as string | undefined;

    // Send notification before restart
    await sendEmbed(
      'Restarting',
      reason || 'Squire is restarting...',
      'yellow'
    );

    // Schedule restart (give time for message to send)
    setTimeout(async () => {
      await selfManageState!.restart();
    }, 1000);

    return 'Restart initiated';
  }
);

// squire_switch_sdk - Switch SDK provider
defineTool(
  'squire_switch_sdk',
  'Switch the AI SDK provider. Options: claude, gemini, codex. The switch takes effect for new conversations.',
  {
    provider: {
      type: 'string',
      description: 'The SDK provider to switch to',
      enum: ['claude', 'gemini', 'codex'],
    },
  },
  ['provider'],
  async (input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    const provider = input.provider as 'claude' | 'gemini' | 'codex';

    try {
      await selfManageState.switchSDK(provider);
      await sendEmbed(
        'SDK Switched',
        `Now using ${provider} as the AI provider`,
        'green'
      );
      return `Successfully switched to ${provider}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sendEmbed('SDK Switch Failed', message, 'red');
      return `Failed to switch SDK: ${message}`;
    }
  }
);

// squire_switch_model - Switch AI model
defineTool(
  'squire_switch_model',
  'Switch the AI model (e.g., claude-3-5-sonnet-20241022, gemini-exp-1206). The switch despawns active sessions so it takes effect immediately.',
  {
    model: {
      type: 'string',
      description: 'The model to switch to',
    },
  },
  ['model'],
  async (input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    const model = input.model as string;

    try {
      await selfManageState.switchModel(model);
      await sendEmbed(
        'Model Switched',
        `Now using ${model} as the AI model`,
        'green'
      );
      return `Successfully switched to model ${model}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sendEmbed('Model Switch Failed', message, 'red');
      return `Failed to switch model: ${message}`;
    }
  }
);

// squire_update_config - Update configuration
defineTool(
  'squire_update_config',
  'Update Squire configuration. Changes persist across restarts.',
  {
    key: {
      type: 'string',
      description: 'Configuration key to update (dot notation supported, e.g., "permissions.mode")',
    },
    value: {
      type: 'string',
      description: 'New value for the configuration key',
    },
  },
  ['key', 'value'],
  async (input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    const key = input.key as string;
    const valueStr = input.value as string;

    // Try to parse as JSON, otherwise use as string
    let value: unknown;
    try {
      value = JSON.parse(valueStr);
    } catch {
      value = valueStr;
    }

    try {
      // Build nested object from dot notation
      const updates: Record<string, unknown> = {};
      const parts = key.split('.');
      let current = updates;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = {};
        current = current[parts[i]] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = value;

      await selfManageState.updateConfig(updates);
      return `Configuration updated: ${key} = ${JSON.stringify(value)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to update config: ${message}`;
    }
  }
);

// squire_reload_skills - Reload skills
defineTool(
  'squire_reload_skills',
  'Reload all skills from disk. Use after adding or modifying skills.',
  {},
  [],
  async (_input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    try {
      await selfManageState.reloadSkills();
      return 'Skills reloaded successfully';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to reload skills: ${message}`;
    }
  }
);

// squire_get_config - Get current configuration
defineTool(
  'squire_get_config',
  'Get the current Squire configuration. Use this to check current settings.',
  {
    key: {
      type: 'string',
      description: 'Optional specific key to get (dot notation). Returns all config if not specified.',
    },
  },
  [],
  async (input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    const config = selfManageState.getConfig();
    const key = input.key as string | undefined;

    if (key) {
      // Navigate dot notation
      const parts = key.split('.');
      let current: unknown = config;
      for (const part of parts) {
        if (typeof current === 'object' && current !== null && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return `Key not found: ${key}`;
        }
      }
      return `${key} = ${JSON.stringify(current, null, 2)}`;
    }

    return `Current configuration:\n${JSON.stringify(config, null, 2)}`;
  }
);

// squire_set_permission_mode - Set permission mode
defineTool(
  'squire_set_permission_mode',
  'Set the permission mode. Options: strict (most approvals), autoSafe (minimal approvals), permissive (no approvals - dangerous).',
  {
    mode: {
      type: 'string',
      description: 'The permission mode to set',
      enum: ['strict', 'autoSafe', 'permissive'],
    },
  },
  ['mode'],
  async (input: Record<string, unknown>) => {
    if (!selfManageState) {
      return 'Self-management not initialized';
    }

    const mode = input.mode as 'strict' | 'autoSafe' | 'permissive';

    await selfManageState.updateConfig({ permissions: { mode } });

    const warning = mode === 'permissive'
      ? ' WARNING: All operations will be auto-approved!'
      : '';

    await sendEmbed(
      'Permission Mode Changed',
      `Permission mode set to: ${mode}${warning}`,
      mode === 'permissive' ? 'red' : 'green'
    );

    return `Permission mode set to ${mode}`;
  }
);
