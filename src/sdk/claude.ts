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
import { shouldAutoApproveInSafeMode, getDangerousReason } from '../permissions/safe-tools.js';



/**
 * Claude SDK Client
 *
 * Provides a unified interface for the Claude CLI.
 * Uses @raylin01/claude-client internally.
 */
export class ClaudeSDKClient extends BaseSDKClient {
  readonly provider = 'claude';
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
        sessionId: this.client?.sessionId,
      });
    });

    // text_accumulated: full accumulated assistant text output
    // Using accumulated mode (like DisCode) for reliable streaming
    this.client.on('text_accumulated', (accumulatedText: string) => {
      this.outputThrottler.addStdout(accumulatedText);
    });

    // thinking_accumulated: full accumulated thinking output
    this.client.on('thinking_accumulated', (accumulatedThinking: string) => {
      this.outputThrottler.addThinking(accumulatedThinking);
    });

    // message: full assistant message object (for tool_use events)
    this.client.on('message', (msg: any) => {
      for (const block of msg?.content || []) {
        if (block.type === 'tool_use') {
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
        const toolName = msg.request.tool_name || 'unknown';
        const input = msg.request.input || {};

        // Check if auto-approval is enabled (autoSafe or permissive mode)
        const permissionMode = this.config.permissionMode;
        const shouldAutoApprove = permissionMode === 'permissive' ||
          (permissionMode === 'autoSafe' && shouldAutoApproveInSafeMode(toolName, input));

        if (shouldAutoApprove) {
          // Auto-approve safe operations
          console.log(`[ClaudeSDK] Auto-approving: ${toolName} (mode: ${permissionMode})`);
          const responseData = {
            behavior: 'allow',
            updatedInput: input,
            message: 'Auto-approved'
          };
          this.client.sendControlResponse(approvalId, responseData).catch((err: Error) => {
            console.warn('[ClaudeSDK] Error sending auto-approval:', err);
          });
          return;
        }

        // Log why approval is needed
        if (toolName === 'Bash' && input.command) {
          const reason = getDangerousReason(input.command as string);
          console.log(`[ClaudeSDK] Tool ${toolName} requires approval${reason ? `: ${reason}` : ''}`);
        }

        // Add to pending approvals and emit event
        this.approvalTracker.add(approvalId, {
          requestId: approvalId,
          toolName,
          input,
          toolUseId: msg.request.tool_use_id || '',
          createdAt: Date.now(),
        });

        this.emit('approval', {
          requestId: approvalId,
          toolName,
          toolInput: input,
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
      console.error('[ClaudeSDK] Error sending message:', error);
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
    console.log(`[ClaudeSDK] sendApproval called: requestId=${requestId}, decision=${decision}`);
    if (!this.client) {
      console.warn(`[ClaudeSDK] sendApproval failed: client not initialized`);
      return;
    }

    const pending = this.approvalTracker.get(requestId);
    if (!pending) {
      console.warn(`[ClaudeSDK] No pending approval for ${requestId}`);
      return;
    }

    try {
      const responseData = decision === 'allow'
        ? { behavior: 'allow', updatedInput }
        : { behavior: 'deny', message: 'Denied by user' };

      await this.client.sendControlResponse(requestId, responseData);
      this.approvalTracker.delete(requestId);

      if (this.approvalTracker.size() === 0) {
        this.setStatus('working');
      }
    } catch (error) {
      console.warn('[ClaudeSDK] Error sending approval:', error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        this.client.kill();
      } catch (error) {
        console.warn('[ClaudeSDK] Error during close:', error);
      }
    }
    this.setStatus('idle');
  }

  /**
   * Override setCwd to restart the Claude process with a new working directory
   */
  async setCwd(newCwd: string): Promise<boolean> {
    if (this.config.cwd === newCwd) {
      return false;
    }

    console.log(`[ClaudeSDK] Changing working directory from ${this.config.cwd} to ${newCwd}`);

    // Close existing client
    await this.close();

    // Update config
    this.config.cwd = newCwd;

    // Restart with new cwd
    await this.start();

    return true;
  }
}
