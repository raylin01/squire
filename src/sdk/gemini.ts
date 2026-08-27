/**
 * Gemini SDK Client Wrapper
 *
 * Uses the structured @raylin01/gemini-client API so Squire receives a
 * normalized turn stream instead of managing the raw CLI transport itself.
 */

import fs from 'fs';
import path from 'path';
import { BaseSDKClient } from './base.js';
import type { MCPServerConfig, SDKConfig, SDKMessage, SDKToolResult, ToolUseEvent } from './types.js';

type OutputSegment = 'stdout' | null;

/**
 * Gemini SDK Client
 */
export class GeminiSDKClient extends BaseSDKClient {
  readonly provider = 'gemini';
  private client: any = null;
  private allowedMcpServerNames: string[] = [];
  private activeOutputSegment: OutputSegment = null;

  constructor(config: SDKConfig) {
    super(config);
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      const { GeminiClient } = await import('@raylin01/gemini-client');
      const runtime = this.prepareRuntimeEnvironment();
      this.allowedMcpServerNames = runtime.allowedMcpServerNames;

      this.client = await GeminiClient.init({
        cwd: this.config.cwd || process.cwd(),
        geminiPath: this.config.cliPath,
        env: runtime.env,
        model: this.config.model,
        outputFormat: 'stream-json',
        approvalMode: this.getApprovalMode(),
        allowedMcpServerNames: this.allowedMcpServerNames,
      });

      if (this.config.resumeSessionId && this.client?.raw?.setSessionId) {
        this.client.raw.setSessionId(this.config.resumeSessionId);
      }

      const sessionId = this.client?.sessionId || this.config.resumeSessionId;
      if (sessionId) {
        this.config.resumeSessionId = sessionId;
      }

      this.emit('metadata', {
        sessionId,
        model: this.config.model,
        permissionMode: this.getApprovalMode(),
      });

      this.setStatus('idle');
    } catch (error) {
      console.warn('[GeminiSDK] Could not initialize Gemini client:', error);
      this.setStatus('error');
    }
  }

  private getApprovalMode(): 'default' | 'auto_edit' | 'yolo' {
    switch (this.config.permissionMode) {
      case 'permissive':
        return 'yolo';
      case 'autoSafe':
        return 'auto_edit';
      case 'strict':
      default:
        return 'default';
    }
  }

  private buildMergedMcpServers(): Record<string, MCPServerConfig> {
    const merged = { ...(this.config.mcpServers || {}) } as Record<string, MCPServerConfig>;
    if (this.config.toolBridge) {
      merged[this.config.toolBridge.serverName] = {
        command: this.config.toolBridge.command,
        args: this.config.toolBridge.args,
        env: this.config.toolBridge.env,
      };
    }
    return merged;
  }

  private ensureRuntimeDir(): string {
    const fallback = path.join(this.config.cwd || process.cwd(), '.squire', 'runtime', 'gemini');
    const runtimeDir = this.config.runtimeDir || fallback;
    fs.mkdirSync(runtimeDir, { recursive: true });
    return runtimeDir;
  }

  private prepareRuntimeEnvironment(): { env: NodeJS.ProcessEnv; allowedMcpServerNames: string[] } {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.env,
    };

    const mergedMcpServers = this.buildMergedMcpServers();
    const allowedMcpServerNames = Object.keys(mergedMcpServers);
    if (allowedMcpServerNames.length === 0) {
      return { env, allowedMcpServerNames };
    }

    const runtimeDir = this.ensureRuntimeDir();
    const settingsPath = path.join(runtimeDir, 'gemini-system-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: mergedMcpServers }, null, 2), 'utf8');
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsPath;

    return { env, allowedMcpServerNames };
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
      const turn = this.client.send(this.materializeMessageForTextCli(message), {
        runOptions: {
          outputFormat: 'stream-json',
          allowedMcpServerNames: this.allowedMcpServerNames,
          model: this.config.model,
          approvalMode: this.getApprovalMode(),
        },
      });

      for await (const update of turn.updates()) {
        this.handleTurnUpdate(update);
      }

      const finalSnapshot = await turn.done;
      const sessionId = finalSnapshot.sessionId || this.client?.sessionId || this.config.resumeSessionId;
      if (sessionId && sessionId !== this.config.resumeSessionId) {
        this.config.resumeSessionId = sessionId;
        this.emit('metadata', { sessionId, model: this.config.model });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.outputThrottler.flush(false);
      this.activeOutputSegment = null;
      this.resetOutputState();
      this.emitError(err);
      throw err;
    }
  }

  private handleTurnUpdate(update: any): void {
    switch (update.kind) {
      case 'queued':
      case 'started':
        this.setStatus('working');
        return;
      case 'output':
        this.handleOutput(update.snapshot);
        return;
      case 'tool_use':
        this.handleToolUse(update.snapshot);
        return;
      case 'tool_result':
        this.activeOutputSegment = null;
        return;
      case 'completed':
        this.handleCompleted(update.snapshot);
        return;
      case 'error':
        this.handleErrored(update.snapshot);
        return;
      default:
        return;
    }
  }

  private handleOutput(snapshot: any): void {
    if (snapshot.currentOutputKind !== 'text') {
      return;
    }

    this.activeOutputSegment = 'stdout';
    if (snapshot.text) {
      this.outputThrottler.addStdout(snapshot.text);
    }
  }

  private handleToolUse(snapshot: any): void {
    this.outputThrottler.flush(false);
    this.resetOutputState();
    this.activeOutputSegment = null;

    const toolUses = Array.isArray(snapshot.toolUses) ? snapshot.toolUses : [];
    const latest = toolUses[toolUses.length - 1];
    if (!latest) {
      return;
    }

    this.emit('tool_use', {
      toolName: latest.name,
      toolId: latest.id,
      input: latest.input || {},
    } as ToolUseEvent);
  }

  private handleCompleted(snapshot: any): void {
    if (snapshot.currentOutputKind === 'text') {
      this.outputThrottler.flush(true);
    } else {
      this.outputThrottler.flush(false);
      this.resetOutputState();
    }

    this.activeOutputSegment = null;
    this.setStatus('idle');
    this.emit('complete');
  }

  private handleErrored(snapshot: any): void {
    this.outputThrottler.flush(false);
    this.activeOutputSegment = null;
    this.resetOutputState();
    const message = snapshot?.result?.error?.message || snapshot?.currentMessage?.content || 'Gemini turn failed.';
    this.emitError(new Error(message));
  }

  async sendToolResult(_result: SDKToolResult): Promise<void> {
    // Gemini tool execution stays inside the CLI. There is no external tool result channel here.
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): Promise<void> {
    const pending = this.approvalTracker.get(requestId);

    if (this.client && typeof this.client.approveRequest === 'function' && decision === 'allow') {
      await this.client.approveRequest(requestId, {
        updatedInput: updatedInput ?? pending?.input ?? {},
        message: 'Approved',
      });
      this.approvalTracker.delete(requestId);
      this.setStatus(this.approvalTracker.size() === 0 ? 'working' : 'waiting');
      return;
    }

    if (this.client && typeof this.client.denyRequest === 'function' && decision === 'deny') {
      await this.client.denyRequest(requestId, 'Denied by user');
      this.approvalTracker.delete(requestId);
      this.setStatus(this.approvalTracker.size() === 0 ? 'working' : 'waiting');
      return;
    }

    // Structured Gemini CLI has no approval response channel. Never pretend an
    // allow succeeded. A deny interrupts the in-flight turn so work stops.
    if (decision === 'deny') {
      await this.interrupt();
      this.approvalTracker.delete(requestId);
      return;
    }

    throw new Error(
      `Gemini cannot apply an allow decision for ${requestId}; the CLI has no approval response channel`
    );
  }

  async interrupt(): Promise<boolean> {
    const hadActiveTurn = this.client?.getCurrentTurn?.()?.status === 'running';

    if (this.client) {
      try {
        await this.client.interrupt?.();
      } catch (error) {
        console.warn('[GeminiSDK] Error interrupting turn:', error);
      }
    }

    this.messageQueue.clear(new Error('Run interrupted'));
    this.approvalTracker.clear();
    this.outputThrottler.flush(false);
    this.resetOutputState();
    this.activeOutputSegment = null;
    this.setStatus('idle');

    return Boolean(hadActiveTurn);
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.warn('[GeminiSDK] Error during shutdown:', error);
      }
    }

    this.client = null;
    this.allowedMcpServerNames = [];
    this.activeOutputSegment = null;
    this.approvalTracker.clear();
    this.resetOutputState();
    this.setStatus('idle');
  }
}
