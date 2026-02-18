/**
 * Squire SDK Abstraction Layer
 *
 * Provides a unified interface for Claude, Gemini, and Codex SDKs.
 */

export * from './types.js';
export * from './base.js';
export * from './claude.js';
export * from './gemini.js';
export * from './codex.js';

import { SDKConfig, SDKProvider } from './types.js';
import { BaseSDKClient } from './base.js';
import { ClaudeSDKClient } from './claude.js';
import { GeminiSDKClient } from './gemini.js';
import { CodexSDKClient } from './codex.js';

/**
 * Create an SDK client for the specified provider
 */
export function createSDKClient(config: SDKConfig): BaseSDKClient {
  switch (config.provider) {
    case 'claude':
      return new ClaudeSDKClient(config);
    case 'gemini':
      return new GeminiSDKClient(config);
    case 'codex':
      return new CodexSDKClient(config);
    default:
      throw new Error(`Unknown SDK provider: ${config.provider}`);
  }
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: SDKProvider): string {
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-4-20250514';
    case 'gemini':
      return 'gemini-2.5-pro';
    case 'codex':
      return 'o3';
    default:
      throw new Error(`Unknown SDK provider: ${provider}`);
  }
}

/**
 * Check if a provider is available (CLI installed)
 */
export async function isProviderAvailable(provider: SDKProvider): Promise<boolean> {
  const commands: Record<SDKProvider, string> = {
    claude: 'claude',
    gemini: 'gemini',
    codex: 'codex',
  };

  try {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
      const proc = spawn('which', [commands[provider]]);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  } catch {
    return false;
  }
}

// Re-export types
export type {
  SDKConfig,
  SDKProvider,
  PermissionMode,
  SDKMessage,
  SDKToolResult,
  SDKImage,
  ToolUseEvent,
  ToolResultEvent,
  ApprovalEvent,
  OutputEvent,
  MetadataEvent,
  ClientStatus,
  MCPServerConfig,
} from './types.js';
