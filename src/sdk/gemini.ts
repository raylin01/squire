/**
 * Gemini SDK Client Wrapper
 *
 * Wrapper around @raylin01/gemini-client for use in Squire.
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
 * Gemini SDK Client
 *
 * Provides a unified interface for the Gemini CLI.
 * Uses @raylin01/gemini-client internally.
 */
export class GeminiSDKClient extends BaseSDKClient {
  readonly provider = 'gemini';
  private client: any = null;

  constructor(config: SDKConfig) {
    super(config);
  }

  async start(): Promise<void> {
    try {
      const { GeminiClient } = await import('@raylin01/gemini-client');

      this.client = new GeminiClient({
        cwd: this.config.cwd || process.cwd(),
        geminiPath: this.config.cliPath,
        env: {
          ...process.env,
          ...this.config.env,
        },
        // Note: model and mcpServers may not be supported by all client versions
      });

      this.setupEventListeners();

      // Actually start the underlying Gemini process
      await this.client.start();

      this.setStatus('idle');
    } catch (error) {
      console.warn('[GeminiSDK] Could not initialize Gemini client:', error);
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

    this.client.on('approval', (event: any) => {
      this.emit('approval', {
        requestId: event.requestId,
        toolName: event.toolName,
        toolInput: event.input,
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
      throw new Error('Gemini client not initialized');
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
      console.warn('[GeminiSDK] Error sending tool result:', error);
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
      console.warn('[GeminiSDK] Error sending approval:', error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (error) {
        console.warn('[GeminiSDK] Error during shutdown:', error);
      }
    }
    this.setStatus('idle');
  }
}
