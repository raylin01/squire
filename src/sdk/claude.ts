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
import { shouldAutoApproveInSafeMode, getDangerousReason, isSquireNativeTool } from '../permissions/safe-tools.js';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';



/**
 * Claude SDK Client
 *
 * Provides a unified interface for the Claude CLI.
 * Uses @raylin01/claude-client internally.
 */
export class ClaudeSDKClient extends BaseSDKClient {
  readonly provider = 'claude';
  private rawJsonlFile = process.env.SQUIRE_DEBUG_RAW_JSONL_FILE || process.env.SQUIRE_DEBUG_RAW_JSONL_PATH || '';
  private rawJsonlEnabled = process.env.SQUIRE_DEBUG_RAW_JSONL === '1' || this.rawJsonlFile.length > 0;
  private rawJsonlStdout = process.env.SQUIRE_DEBUG_RAW_JSONL_STDOUT === '1';
  private client: any = null;
  private emittedToolUseIds = new Set<string>();

  constructor(config: SDKConfig) {
    super(config);
    // Client initialization deferred to start() to avoid import issues
  }

  async start(): Promise<void> {
    try {
      // Dynamic import to handle missing package gracefully
      const { ClaudeClient } = await import('@raylin01/claude-client');
      const mcpServers = { ...(this.config.mcpServers || {}) };
      if (this.config.toolBridge) {
        mcpServers[this.config.toolBridge.serverName] = {
          command: this.config.toolBridge.command,
          args: this.config.toolBridge.args,
          env: this.config.toolBridge.env,
        };
      }

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
        mcpServers,
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

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, (_key, current) =>
        typeof current === 'bigint' ? current.toString() : current
      );
    } catch {
      return JSON.stringify({ note: 'unserializable payload' });
    }
  }

  private logRawJsonl(kind: string, payload: unknown): void {
    if (!this.rawJsonlEnabled) return;

    const line = this.safeStringify({
      ts: new Date().toISOString(),
      provider: this.provider,
      sessionId: this.client?.sessionId || this.config.resumeSessionId || null,
      kind,
      payload,
    });

    if (this.rawJsonlStdout) {
      console.log(`[StreamDebug][RawJSONL] ${line}`);
    }

    if (!this.rawJsonlFile) return;
    try {
      mkdirSync(dirname(this.rawJsonlFile), { recursive: true });
      appendFileSync(this.rawJsonlFile, `${line}\n`, 'utf8');
    } catch (error) {
      console.warn('[ClaudeSDK] Failed to append raw JSONL debug log:', error);
      this.rawJsonlFile = '';
    }
  }

  /**
   * Sends a control response using the canonical top-level shape first.
   * Falls back to the client helper for compatibility with older wrappers.
   */
  private async sendControlResponse(
    requestId: string,
    responseData: { behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; message?: string }
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Claude client not initialized');
    }

    let sent = false;

    // Newer Claude protocol shape.
    const directWriter = this.client.writeToStdin;
    if (typeof directWriter === 'function') {
      try {
        await directWriter.call(this.client, {
          type: 'control_response',
          request_id: requestId,
          subtype: 'success',
          response: responseData,
        });
        sent = true;
      } catch (error) {
        if (this.config.debug) {
          console.warn('[ClaudeSDK] Direct control_response failed:', error);
        }
      }
    }

    // Compatibility for wrappers expecting nested envelope form.
    try {
      await this.client.sendControlResponse(requestId, responseData);
      sent = true;
    } catch (error) {
      if (this.config.debug) {
        console.warn('[ClaudeSDK] Envelope control_response failed:', error);
      }
    }

    if (!sent) {
      throw new Error('Failed to send control_response in any supported shape.');
    }
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    // Map client events to our unified interface
    this.client.on('system', (msg: any) => {
      this.logRawJsonl('system', msg);
      this.emit('metadata', {
        model: msg.model,
        permissionMode: msg.permissionMode,
        sessionId: this.client?.sessionId,
      });
    });

    // text_accumulated: full accumulated assistant text output
    // Using accumulated mode (like DisCode) for reliable streaming
    this.client.on('text_accumulated', (accumulatedText: string) => {
      this.logRawJsonl('text_accumulated', { accumulatedText });
      this.outputThrottler.addStdout(accumulatedText);
    });

    // thinking_accumulated: full accumulated thinking output
    this.client.on('thinking_accumulated', (accumulatedThinking: string) => {
      this.logRawJsonl('thinking_accumulated', { accumulatedThinking });
      this.outputThrottler.addThinking(accumulatedThinking);
    });

    // Stream-level tool boundary (fires as soon as tool block is parsed)
    this.client.on('tool_use_start', (tool: any) => {
      this.logRawJsonl('tool_use_start', tool);
      // Flush any buffered text/thinking first so tool boundary ordering is preserved.
      this.outputThrottler.flush(false);
      const toolId = String(tool?.id || '');
      const toolName = String(tool?.name || 'unknown');
      if (!toolId || this.emittedToolUseIds.has(toolId)) {
        return;
      }
      this.emittedToolUseIds.add(toolId);
      this.emit('tool_use', {
        toolName,
        toolId,
        input: (tool?.input || {}) as Record<string, unknown>,
      } as ToolUseEvent);
    });

    // message: full assistant message object (for tool_use events)
    this.client.on('message', (msg: any) => {
      this.logRawJsonl('message', msg);
      for (const block of msg?.content || []) {
        if (block.type === 'tool_use') {
          // Flush any buffered text/thinking first so tool boundary ordering is preserved.
          this.outputThrottler.flush(false);
          const toolId = String(block.id || '');
          if (toolId && this.emittedToolUseIds.has(toolId)) {
            continue;
          }
          if (toolId) {
            this.emittedToolUseIds.add(toolId);
          }
          this.emit('tool_use', {
            toolName: block.name,
            toolId: block.id,
            input: block.input,
          } as ToolUseEvent);
        }
      }
    });

    this.client.on('control_request', (msg: any) => {
      this.logRawJsonl('control_request', msg);
      if (msg.request?.subtype === 'can_use_tool') {
        const approvalId = msg.request_id;
        const toolName = msg.request.tool_name || 'unknown';
        const input = msg.request.input || {};
        const squireNativeTool = isSquireNativeTool(toolName);

        // Check if auto-approval is enabled (autoSafe or permissive mode)
        const permissionMode = this.config.permissionMode;
        const shouldAutoApprove = squireNativeTool ||
          permissionMode === 'permissive' ||
          (permissionMode === 'autoSafe' && shouldAutoApproveInSafeMode(toolName, input));

        if (shouldAutoApprove) {
          // Auto-approve safe operations
          console.log(`[ClaudeSDK] Auto-approving: ${toolName} (mode: ${permissionMode}${squireNativeTool ? ', squire-native' : ''})`);
          const responseData = {
            behavior: 'allow' as const,
            updatedInput: input,
            message: 'Auto-approved'
          };
          this.sendControlResponse(approvalId, responseData).catch((err: Error) => {
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
      this.logRawJsonl('result', { event: 'result' });
      this.emittedToolUseIds.clear();
      this.setStatus('idle');
      this.outputThrottler.flush(true);
      this.emit('complete');
    });

    this.client.on('error', (error: Error) => {
      this.logRawJsonl('error', { message: error.message, stack: error.stack });
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
    this.logRawJsonl('sendMessage.input', { message });

    try {
      // Use the client's sendMessage method
      await this.client.sendMessage(message.content);
      this.logRawJsonl('sendMessage.accepted', { messageLength: message.content.length });
    } catch (error) {
      this.logRawJsonl('sendMessage.error', { error: String(error) });
      console.error('[ClaudeSDK] Error sending message:', error);
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async sendToolResult(result: SDKToolResult): Promise<void> {
    if (!this.client) return;

    try {
      this.logRawJsonl('sendToolResult.input', result);
      await this.client.sendToolResult({
        toolUseId: result.toolUseId,
        content: result.content,
        isError: result.isError,
      });
      this.logRawJsonl('sendToolResult.accepted', { toolUseId: result.toolUseId });
    } catch (error) {
      this.logRawJsonl('sendToolResult.error', { error: String(error) });
      console.warn('[ClaudeSDK] Error sending tool result:', error);
    }
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): Promise<void> {
    this.logRawJsonl('sendApproval.input', { requestId, decision, updatedInput });
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
      const effectiveUpdatedInput = updatedInput ?? pending.input ?? {};
      const responseData = decision === 'allow'
        ? { behavior: 'allow' as const, updatedInput: effectiveUpdatedInput, message: 'Approved' }
        : { behavior: 'deny' as const, message: 'Denied by user' };

      await this.sendControlResponse(requestId, responseData);
      this.logRawJsonl('sendApproval.accepted', { requestId, decision });
      this.approvalTracker.delete(requestId);

      if (this.approvalTracker.size() === 0) {
        this.setStatus('working');
      }
    } catch (error) {
      this.logRawJsonl('sendApproval.error', { requestId, decision, error: String(error) });
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
