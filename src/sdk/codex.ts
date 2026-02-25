/**
 * Codex SDK Client Wrapper
 *
 * Wrapper around @raylin01/codex-client for use in Squire.
 */

import { BaseSDKClient } from './base.js';
import type { MCPServerConfig, SDKConfig, SDKMessage, SDKToolResult, ToolUseEvent } from './types.js';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

type TurnPromise = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type PendingApproval = {
  rpcRequestId: string | number;
  kind: 'command' | 'file';
};

/**
 * Codex SDK Client
 *
 * Provides a unified interface for the Codex CLI app-server.
 */
export class CodexSDKClient extends BaseSDKClient {
  readonly provider = 'codex';
  private rawJsonlFile = process.env.SQUIRE_DEBUG_RAW_JSONL_FILE || process.env.SQUIRE_DEBUG_RAW_JSONL_PATH || '';
  private rawJsonlEnabled = process.env.SQUIRE_DEBUG_RAW_JSONL === '1' || this.rawJsonlFile.length > 0;
  private rawJsonlStdout = process.env.SQUIRE_DEBUG_RAW_JSONL_STDOUT === '1';
  private client: any = null;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private pendingTurns = new Map<string, TurnPromise>();
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(config: SDKConfig) {
    super(config);
  }

  async start(): Promise<void> {
    if (this.client && this.threadId) {
      return;
    }

    try {
      const { CodexClient } = await import('@raylin01/codex-client');
      const args = this.buildCodexConfigArgs();

      this.client = new CodexClient({
        cwd: this.config.cwd || process.cwd(),
        codexPath: this.config.cliPath,
        env: {
          ...process.env,
          ...this.config.env,
        },
        args,
      });

      this.setupEventListeners();
      await this.client.start();
      await this.initializeThread();

      this.setStatus('idle');
    } catch (error) {
      console.warn('[CodexSDK] Could not initialize Codex client:', error);
      this.setStatus('error');
    }
  }

  private getApprovalPolicy(): 'never' | 'on-request' {
    return this.config.permissionMode === 'permissive' ? 'never' : 'on-request';
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
      threadId: this.threadId,
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
      console.warn('[CodexSDK] Failed to append raw JSONL debug log:', error);
      this.rawJsonlFile = '';
    }
  }

  private toTomlString(value: string): string {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  private toTomlDottedKeySegment(value: string): string {
    return /^[A-Za-z0-9_-]+$/.test(value)
      ? value
      : this.toTomlString(value);
  }

  private toTomlArray(values: string[]): string {
    return `[${values.map((value) => this.toTomlString(value)).join(',')}]`;
  }

  private toTomlInlineTable(values: Record<string, string>): string {
    const entries = Object.entries(values).map(([key, value]) => {
      const tomlKey = /^[A-Za-z0-9_-]+$/.test(key) ? key : this.toTomlString(key);
      return `${tomlKey}=${this.toTomlString(value)}`;
    });
    return `{${entries.join(',')}}`;
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

  private buildCodexConfigArgs(): string[] {
    const args: string[] = [];
    const mcpServers = this.buildMergedMcpServers();

    for (const [name, server] of Object.entries(mcpServers)) {
      const prefix = `mcp_servers.${this.toTomlDottedKeySegment(name)}`;
      if (server.command) {
        args.push('-c', `${prefix}.command=${this.toTomlString(server.command)}`);
      }
      if (Array.isArray(server.args) && server.args.length > 0) {
        args.push('-c', `${prefix}.args=${this.toTomlArray(server.args)}`);
      }
      if (server.env && Object.keys(server.env).length > 0) {
        args.push('-c', `${prefix}.env=${this.toTomlInlineTable(server.env)}`);
      }
      if (server.cwd) {
        args.push('-c', `${prefix}.cwd=${this.toTomlString(server.cwd)}`);
      }
      if (server.url) {
        args.push('-c', `${prefix}.url=${this.toTomlString(server.url)}`);
      }
    }

    return args;
  }

  private async initializeThread(): Promise<void> {
    if (!this.client || this.threadId) {
      return;
    }

    const baseParams = {
      model: this.config.model || null,
      modelProvider: null,
      cwd: this.config.cwd || process.cwd(),
      approvalPolicy: this.getApprovalPolicy(),
      sandbox: null,
      config: null,
      baseInstructions: null,
      developerInstructions: null,
      personality: null,
    };

    const response = this.config.resumeSessionId
      ? await this.client.resumeThread({
          threadId: this.config.resumeSessionId,
          ...baseParams,
        })
      : await this.client.startThread({
          ...baseParams,
          ephemeral: false,
          experimentalRawEvents: false,
        });

    this.threadId = response?.thread?.id || null;
    if (!this.threadId) {
      throw new Error('Codex thread initialization failed: missing thread ID.');
    }

    this.emit('metadata', {
      sessionId: this.threadId,
      model: response?.model || this.config.model,
      permissionMode: this.getApprovalPolicy(),
    });
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on('notification', (notification: any) => {
      this.logRawJsonl('notification', notification);
      this.handleNotification(notification);
    });

    this.client.on('request', (request: any) => {
      this.logRawJsonl('request', request);
      this.handleRequest(request);
    });

    this.client.on('error', (error: Error) => {
      this.rejectAllPendingTurns(error);
      this.emitError(error);
    });
  }

  private handleNotification(notification: any): void {
    const params = (notification?.params || {}) as Record<string, any>;
    const threadId = params.threadId || params.thread?.id;
    if (threadId && this.threadId && threadId !== this.threadId) {
      return;
    }

    switch (notification?.method) {
      case 'item/agentMessage/delta':
        this.appendOutput(String(params.delta || ''), false);
        break;
      case 'item/commandExecution/outputDelta':
        this.appendOutput(String(params.delta || ''), false);
        break;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        this.appendThinkingDelta(String(params.delta || ''), false);
        break;
      case 'item/started': {
        const item = params.item || {};
        const type = String(item.type || '');
        if (type === 'mcpToolCall' || type === 'commandExecution' || type === 'fileChange') {
          this.outputThrottler.flush(false);
          this.emit('tool_use', {
            toolName: String(item.tool || item.name || type || 'tool'),
            toolId: String(item.id || `${params.turnId || 'turn'}:${type}`),
            input: (item.arguments && typeof item.arguments === 'object') ? item.arguments : {},
          } as ToolUseEvent);
        }
        break;
      }
      case 'item/completed': {
        const item = params.item || {};
        if (item.type === 'agentMessage' && typeof item.text === 'string') {
          this.emitOutput(item.text, false, 'stdout');
        }
        break;
      }
      case 'turn/started':
        this.activeTurnId = String(params.turn?.id || this.activeTurnId || '');
        this.setStatus('working');
        break;
      case 'turn/completed': {
        const turnId = String(params.turn?.id || params.turnId || this.activeTurnId || '');
        this.activeTurnId = null;
        this.outputThrottler.flush(true);
        this.resolvePendingTurn(turnId);
        this.setStatus('idle');
        this.emit('complete');
        break;
      }
      case 'error': {
        const willRetry = Boolean(params.willRetry);
        if (!willRetry) {
          const message = String(params.error?.message || 'Codex reported an error.');
          const error = new Error(message);
          this.rejectPendingTurn(String(params.turnId || this.activeTurnId || ''), error);
          this.emitError(error);
        }
        break;
      }
      default:
        break;
    }
  }

  private handleRequest(request: any): void {
    const params = (request?.params || {}) as Record<string, any>;
    const threadId = params.threadId || params.conversationId;
    if (threadId && this.threadId && threadId !== this.threadId) {
      return;
    }

    switch (request?.method) {
      case 'item/commandExecution/requestApproval': {
        const approvalId = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const toolInput = {
          command: params.command,
          cwd: params.cwd,
          reason: params.reason,
        } as Record<string, unknown>;
        this.pendingApprovals.set(approvalId, {
          rpcRequestId: request.id,
          kind: 'command',
        });
        this.approvalTracker.add(approvalId, {
          requestId: approvalId,
          toolName: 'bash',
          input: toolInput,
          createdAt: Date.now(),
        });
        this.emit('approval', {
          requestId: approvalId,
          toolName: 'bash',
          toolInput,
          context: typeof params.reason === 'string' ? params.reason : undefined,
        });
        this.setStatus('waiting');
        break;
      }
      case 'item/fileChange/requestApproval': {
        const approvalId = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const toolInput = {
          reason: params.reason,
          grantRoot: params.grantRoot,
        } as Record<string, unknown>;
        this.pendingApprovals.set(approvalId, {
          rpcRequestId: request.id,
          kind: 'file',
        });
        this.approvalTracker.add(approvalId, {
          requestId: approvalId,
          toolName: 'file_change',
          input: toolInput,
          createdAt: Date.now(),
        });
        this.emit('approval', {
          requestId: approvalId,
          toolName: 'file_change',
          toolInput,
          context: typeof params.reason === 'string' ? params.reason : undefined,
        });
        this.setStatus('waiting');
        break;
      }
      case 'item/tool/requestUserInput':
        this.client.sendError(request.id, { message: 'item/tool/requestUserInput is not supported in this integration.' });
        break;
      case 'item/tool/call':
        this.client.sendResponse(request.id, {
          contentItems: [{ type: 'inputText', text: 'Dynamic tool calls are not supported in this integration.' }],
          success: false,
        });
        break;
      default:
        this.client.sendError(request.id, { message: `Unsupported request: ${request.method}` });
        break;
    }
  }

  private resolvePendingTurn(turnId: string): void {
    if (!turnId) {
      if (this.pendingTurns.size === 1) {
        const first = this.pendingTurns.keys().next().value as string | undefined;
        if (first) {
          this.resolvePendingTurn(first);
        }
      }
      return;
    }

    const pending = this.pendingTurns.get(turnId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingTurns.delete(turnId);
    pending.resolve();
  }

  private rejectPendingTurn(turnId: string, error: Error): void {
    if (!turnId) return;
    const pending = this.pendingTurns.get(turnId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingTurns.delete(turnId);
    pending.reject(error);
  }

  private rejectAllPendingTurns(error: Error): void {
    for (const [turnId, pending] of this.pendingTurns) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingTurns.delete(turnId);
    }
  }

  protected async doSendMessage(message: SDKMessage): Promise<void> {
    if (!this.client || !this.threadId) {
      await this.start();
    }

    if (!this.client || !this.threadId) {
      throw new Error('Codex client not initialized');
    }

    this.setStatus('working');
    this.logRawJsonl('startTurn.input', {
      threadId: this.threadId,
      message,
      approvalPolicy: this.getApprovalPolicy(),
      model: this.config.model || null,
    });

    try {
      const response = await this.client.startTurn({
        threadId: this.threadId,
        input: [{ type: 'text', text: message.content, text_elements: [] }],
        cwd: null,
        approvalPolicy: this.getApprovalPolicy(),
        sandboxPolicy: null,
        model: this.config.model || null,
        effort: null,
        summary: null,
        personality: null,
        outputSchema: null,
        collaborationMode: null,
      });

      const turnId = String(response?.turn?.id || '');
      this.logRawJsonl('startTurn.response', response);
      this.activeTurnId = turnId || null;

      if (!turnId) {
        this.outputThrottler.flush(true);
        this.setStatus('idle');
        this.emit('complete');
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingTurns.delete(turnId);
          reject(new Error(`Codex turn timed out: ${turnId}`));
        }, 10 * 60 * 1000);

        this.pendingTurns.set(turnId, {
          resolve,
          reject,
          timer,
        });
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitError(err);
      throw err;
    }
  }

  async sendToolResult(_result: SDKToolResult): Promise<void> {
    // MCP tools execute inside Codex directly; no out-of-band tool result channel is used here.
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    _updatedInput?: Record<string, unknown>
  ): Promise<void> {
    if (!this.client) return;

    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;

    try {
      if (pending.kind === 'command') {
        this.client.sendResponse(pending.rpcRequestId, {
          decision: decision === 'allow' ? 'accept' : 'decline',
        });
      } else {
        this.client.sendResponse(pending.rpcRequestId, {
          decision: decision === 'allow' ? 'accept' : 'decline',
        });
      }
    } catch (error) {
      console.warn('[CodexSDK] Error sending approval:', error);
    } finally {
      this.pendingApprovals.delete(requestId);
      this.approvalTracker.delete(requestId);
      if (!this.hasPendingApprovals()) {
        this.setStatus('working');
      }
    }
  }

  async close(): Promise<void> {
    this.rejectAllPendingTurns(new Error('Codex session closed.'));

    if (this.client && this.threadId && this.activeTurnId) {
      try {
        await this.client.interruptTurn({ threadId: this.threadId, turnId: this.activeTurnId });
      } catch {
        // Ignore interrupt failures on shutdown.
      }
    }

    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (error) {
        console.warn('[CodexSDK] Error during shutdown:', error);
      }
    }

    this.client = null;
    this.threadId = null;
    this.activeTurnId = null;
    this.pendingApprovals.clear();
    this.approvalTracker.clear();
    this.setStatus('idle');
  }
}
