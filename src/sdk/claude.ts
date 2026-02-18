/**
 * Claude SDK Client Wrapper
 *
 * Wrapper around @raylin01/claude-client for use in Squire.
 * NOTE: This is a simplified stub. Full integration requires matching
 * the actual client library API.
 */

import { BaseSDKClient, PendingApprovalTracker } from './base.js';
import {
  SDKConfig,
  SDKMessage,
  SDKToolResult,
  ToolUseEvent,
  ApprovalEvent,
} from './types.js';

interface ClaudePendingApproval {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  createdAt: number;
}

/**
 * Claude SDK Client
 *
 * Provides a unified interface for the Claude CLI.
 * Uses @raylin01/claude-client internally.
 */
export class ClaudeSDKClient extends BaseSDKClient {
  readonly provider = 'claude';
  private pendingApprovals = new PendingApprovalTracker<ClaudePendingApproval>();
  private client: any = null;

  constructor(config: SDKConfig) {
    super(config);
    // Client initialization deferred to start() to avoid import issues
  }

  async start(): Promise<void> {
    try {
      // Dynamic import to handle missing package gracefully
      const { ClaudeClient } = await import('@raylin01/claude-client');

      const permissionMode = this.config.permissionMode === 'permissive'
        ? 'acceptEdits'
        : 'default';

      this.client = new ClaudeClient({
        cwd: this.config.cwd || process.cwd(),
        claudePath: this.config.cliPath,
        debug: this.config.debug,
        env: {
          ...process.env,
          ...this.config.env,
        },
        model: this.config.model,
        resumeSessionId: this.config.resumeSessionId,
        permissionMode,
        mcpServers: this.config.mcpServers,
      });

      this.setupEventListeners();

      // Actually start the underlying Claude process
      await this.client.start();

      this.setStatus('idle');
    } catch (error) {
      console.warn('[ClaudeSDK] Could not initialize Claude client:', error);
      this.setStatus('error');
    }
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    // Map client events to our unified interface
    this.client.on('system', (msg: any) => {
      this.emit('metadata', {
        model: msg.model,
        permissionMode: msg.permissionMode,
      });
    });

    this.client.on('assistant', (msg: any) => {
      for (const block of msg.message?.content || []) {
        if (block.type === 'text') {
          this.emitOutput(block.text, false, 'stdout');
        } else if (block.type === 'tool_use') {
          this.emit('tool_use', {
            toolName: block.name,
            toolId: block.id,
            input: block.input,
          } as ToolUseEvent);
        }
      }
    });

    this.client.on('control_request', (msg: any) => {
      if (msg.request?.subtype === 'can_use_tool') {
        const approvalId = msg.request_id;
        this.pendingApprovals.add(approvalId, {
          requestId: approvalId,
          toolName: msg.request.tool_name || 'unknown',
          input: msg.request.input || {},
          toolUseId: msg.request.tool_use_id || '',
          createdAt: Date.now(),
        });

        this.emit('approval', {
          requestId: approvalId,
          toolName: msg.request.tool_name || 'unknown',
          toolInput: msg.request.input || {},
          context: msg.request.decision_reason,
        } as ApprovalEvent);

        this.setStatus('waiting');
      }
    });

    this.client.on('result', () => {
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
      throw new Error('Claude client not initialized');
    }

    this.setStatus('working');

    try {
      // Use the client's sendMessage method
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
      console.warn('[ClaudeSDK] Error sending tool result:', error);
    }
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): Promise<void> {
    if (!this.client) return;

    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      console.warn(`[ClaudeSDK] No pending approval for ${requestId}`);
      return;
    }

    try {
      const responseData = decision === 'allow'
        ? { behavior: 'allow', updatedInput }
        : { behavior: 'deny', message: 'Denied by user' };

      await this.client.sendControlResponse(requestId, responseData);
      this.pendingApprovals.delete(requestId);

      if (this.pendingApprovals.size() === 0) {
        this.setStatus('working');
      }
    } catch (error) {
      console.warn('[ClaudeSDK] Error sending approval:', error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (error) {
        console.warn('[ClaudeSDK] Error during shutdown:', error);
      }
    }
    this.setStatus('idle');
  }
}
