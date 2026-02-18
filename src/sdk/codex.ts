/**
 * Codex SDK Client Wrapper
 *
 * Wrapper around @raylin01/codex-client for use in Squire.
 * NOTE: This is a simplified stub. Full integration requires matching
 * the actual client library API.
 */

import { BaseSDKClient } from './base.js';
import {
  SDKConfig,
  SDKMessage,
  SDKToolResult,
  ToolUseEvent,
  ApprovalEvent,
} from './types.js';

/**
 * Codex SDK Client
 *
 * Provides a unified interface for the Codex CLI.
 * Uses @raylin01/codex-client internally.
 */
export class CodexSDKClient extends BaseSDKClient {
  readonly provider = 'codex';
  private client: any = null;

  constructor(config: SDKConfig) {
    super(config);
  }

  async start(): Promise<void> {
    try {
      const { CodexClient } = await import('@raylin01/codex-client');

      this.client = new CodexClient({
        cwd: this.config.cwd || process.cwd(),
        codexPath: this.config.cliPath,
        env: {
          ...process.env,
          ...this.config.env,
        },
        // Note: model, resumeSessionId, and mcpServers may not be supported by all client versions
      });

      this.setupEventListeners();
      this.setStatus('idle');
    } catch (error) {
      console.warn('[CodexSDK] Could not initialize Codex client:', error);
      this.setStatus('error');
    }
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    // Map client events to our unified interface
    this.client.on('content', (content: string) => {
      this.emitOutput(content, false, 'stdout');
    });

    this.client.on('thinking', (thinking: string) => {
      this.emitThinking(thinking, false);
    });

    this.client.on('tool_use', (event: any) => {
      this.emit('tool_use', {
        toolName: event.name,
        toolId: event.id,
        input: event.input,
      } as ToolUseEvent);
    });

    this.client.on('tool_result', (event: any) => {
      this.emit('tool_result', {
        toolUseId: event.toolUseId,
        content: event.content,
        isError: event.isError,
      });
    });

    this.client.on('command_approval', (event: any) => {
      this.emit('approval', {
        requestId: event.requestId,
        toolName: 'bash',
        toolInput: { command: event.command },
      } as ApprovalEvent);
      this.setStatus('waiting');
    });

    this.client.on('file_approval', (event: any) => {
      this.emit('approval', {
        requestId: event.requestId,
        toolName: 'file_' + event.operation,
        toolInput: { path: event.path },
      } as ApprovalEvent);
      this.setStatus('waiting');
    });

    this.client.on('complete', () => {
      this.setStatus('idle');
      this.outputThrottler.flush(true);
      this.emit('complete');
    });

    this.client.on('error', (error: Error) => {
      this.emitError(error);
    });
  }

  protected async doSendMessage(message: SDKMessage): Promise<void> {
    if (!this.client) {
      await this.start();
    }

    if (!this.client) {
      throw new Error('Codex client not initialized');
    }

    this.setStatus('working');

    try {
      await this.client.sendMessage(message.content);
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async sendToolResult(result: SDKToolResult): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.sendToolResult({
        toolUseId: result.toolUseId,
        content: result.content,
        isError: result.isError,
      });
    } catch (error) {
      console.warn('[CodexSDK] Error sending tool result:', error);
    }
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    _updatedInput?: Record<string, unknown>
  ): Promise<void> {
    if (!this.client) return;

    try {
      if (decision === 'allow') {
        await this.client.approve(requestId);
      } else {
        await this.client.deny(requestId);
      }

      if (!this.hasPendingApprovals()) {
        this.setStatus('working');
      }
    } catch (error) {
      console.warn('[CodexSDK] Error sending approval:', error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (error) {
        console.warn('[CodexSDK] Error during shutdown:', error);
      }
    }
    this.setStatus('idle');
  }
}
