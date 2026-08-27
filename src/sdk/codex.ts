/**
 * Codex SDK Client Wrapper
 *
 * Uses the structured @raylin01/codex-client API so Squire can consume a
 * normalized turn stream and respond to approval/question requests cleanly.
 */

import { BaseSDKClient, PendingApprovalEntry, PendingApprovalTracker } from './base.js';
import type { MCPServerConfig, SDKConfig, SDKMessage, SDKToolResult, ApprovalEvent, ToolUseEvent } from './types.js';

type OutputSegment = 'stdout' | 'thinking' | null;

interface PendingCodexRequest extends PendingApprovalEntry {
  requestKind: 'tool_approval' | 'question';
}

/**
 * Codex SDK Client
 */
export class CodexSDKClient extends BaseSDKClient {
  readonly provider = 'codex';
  private client: any = null;
  private activeOutputSegment: OutputSegment = null;

  constructor(config: SDKConfig) {
    super(config);
    this.approvalTracker = new PendingApprovalTracker<PendingCodexRequest>() as PendingApprovalTracker;
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      const { CodexClient } = await import('@raylin01/codex-client');

      this.client = await CodexClient.init({
        cwd: this.config.cwd || process.cwd(),
        codexPath: this.config.cliPath,
        env: {
          ...process.env,
          ...this.config.env,
        },
        args: this.buildCodexConfigArgs(),
        resumeThreadId: this.config.resumeSessionId,
        model: this.config.model || null,
        approvalPolicy: this.getApprovalPolicy(),
        experimentalRawEvents: false,
      });

      const sessionId = this.client?.providerThreadId || this.config.resumeSessionId;
      if (sessionId) {
        this.config.resumeSessionId = sessionId;
      }

      this.emit('metadata', {
        sessionId,
        model: this.config.model,
        permissionMode: this.getApprovalPolicy(),
      });

      this.setStatus('idle');
    } catch (error) {
      console.warn('[CodexSDK] Could not initialize Codex client:', error);
      this.setStatus('error');
    }
  }

  private getApprovalPolicy(): 'never' | 'on-request' {
    return this.config.permissionMode === 'permissive' ? 'never' : 'on-request';
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

  protected async doSendMessage(message: SDKMessage): Promise<void> {
    if (!this.client) {
      await this.start();
    }

    if (!this.client) {
      throw new Error('Codex client not initialized');
    }

    this.setStatus('working');

    try {
      const turn = this.client.send(this.materializeMessageForTextCli(message), {
        approvalPolicy: this.getApprovalPolicy(),
        model: this.config.model || null,
      });

      for await (const update of turn.updates()) {
        await this.handleTurnUpdate(update);
      }

      const finalSnapshot = await turn.done;
      const sessionId = finalSnapshot.providerThreadId || this.client?.providerThreadId || this.config.resumeSessionId;
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

  private async handleTurnUpdate(update: any): Promise<void> {
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
      case 'request':
        await this.handleRequest(update.snapshot);
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
    const kind = snapshot.currentOutputKind;
    if (kind === 'text') {
      if (this.activeOutputSegment === 'thinking') {
        this.outputThrottler.flush(false);
        this.resetOutputState();
      }
      this.activeOutputSegment = 'stdout';
      if (snapshot.text) {
        this.outputThrottler.addStdout(snapshot.text);
      }
      return;
    }

    if (kind === 'thinking') {
      if (this.activeOutputSegment === 'stdout') {
        this.outputThrottler.flush(false);
        this.resetOutputState();
      }
      this.activeOutputSegment = 'thinking';
      if (snapshot.thinking) {
        this.outputThrottler.addThinking(snapshot.thinking);
      }
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

  private async handleRequest(snapshot: any): Promise<void> {
    const openRequests = Array.isArray(snapshot.openRequests) ? snapshot.openRequests : [];
    const request = openRequests[openRequests.length - 1];
    if (!request) {
      return;
    }

    if (request.kind === 'tool_call') {
      await this.client.respondToToolCall(request.id, {
        contentItems: [{ type: 'inputText', text: 'Dynamic tool calls are not supported in this integration.' }],
        success: false,
      });
      return;
    }

    if ((this.approvalTracker as PendingApprovalTracker<PendingCodexRequest>).has(request.id)) {
      return;
    }

    this.outputThrottler.flush(false);
    this.resetOutputState();
    this.activeOutputSegment = null;

    const approvalEvent = this.toApprovalEvent(request);
    (this.approvalTracker as PendingApprovalTracker<PendingCodexRequest>).add(request.id, {
      requestId: request.id,
      toolName: approvalEvent.toolName,
      input: approvalEvent.toolInput,
      createdAt: Date.now(),
      requestKind: request.kind,
    });

    this.emit('approval', approvalEvent);
    this.setStatus('waiting');
  }

  private toApprovalEvent(request: any): ApprovalEvent {
    if (request.kind === 'question') {
      const firstQuestion = Array.isArray(request.questions) ? request.questions[0] : undefined;
      return {
        requestId: request.id,
        toolName: 'AskUserQuestion',
        toolInput: {
          question: firstQuestion?.question,
          questions: (request.questions || []).map((question: any) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            isOther: question.isOther,
            isSecret: question.isSecret,
            options: (question.options || []).map((option: any) => ({
              label: option.label,
              description: option.description,
            })),
          })),
        },
        context: firstQuestion?.question,
        options: (firstQuestion?.options || []).map((option: any) => ({
          label: option.label,
          description: option.description,
        })),
      };
    }

    return {
      requestId: request.id,
      toolName: request.approvalKind === 'command' ? 'bash' : 'file_change',
      toolInput: {
        command: request.command,
        cwd: request.cwd,
        reason: request.reason,
        grantRoot: request.grantRoot,
        proposedExecPolicyAmendment: request.proposedExecPolicyAmendment,
      },
      context: request.reason || undefined,
    };
  }

  private handleCompleted(snapshot: any): void {
    const kind = snapshot.currentOutputKind;
    if (kind === 'text' || kind === 'thinking') {
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
    const message = snapshot?.result?.error?.message || snapshot?.currentMessage?.content || 'Codex turn failed.';
    this.emitError(new Error(message));
  }

  async sendToolResult(_result: SDKToolResult): Promise<void> {
    // MCP tools execute inside Codex directly; no external tool result channel is used here.
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    const pending = (this.approvalTracker as PendingApprovalTracker<PendingCodexRequest>).get(requestId);
    if (!pending) {
      return;
    }

    try {
      if (pending.requestKind === 'question') {
        const answer = decision === 'allow'
          ? this.normalizeQuestionAnswerInput(updatedInput)
          : '';
        await this.client.answerQuestion(requestId, answer);
      } else if (decision === 'allow') {
        await this.client.approveRequest(requestId, { behavior: 'allow' });
      } else {
        await this.client.denyRequest(requestId, 'Denied by user');
      }
    } catch (error) {
      console.warn('[CodexSDK] Error sending approval:', error);
      return;
    }

    this.approvalTracker.delete(requestId);
    const remaining = (this.client.getOpenRequests?.() || []).filter((request: any) => request.kind !== 'tool_call').length;
    this.setStatus(remaining > 0 ? 'waiting' : 'working');
  }

  async interrupt(): Promise<boolean> {
    if (!this.client) {
      this.messageQueue.clear(new Error('Run interrupted'));
      this.approvalTracker.clear();
      this.resetOutputState();
      this.activeOutputSegment = null;
      this.setStatus('idle');
      return false;
    }

    const hadActiveTurn = this.client.getCurrentTurn?.()?.status === 'running';
    const hadPendingRequests = (this.client.getOpenRequests?.() || []).length > 0;

    try {
      await this.client.interruptCurrentTurn?.();
    } catch (error) {
      console.warn('[CodexSDK] Error interrupting turn:', error);
    }

    this.messageQueue.clear(new Error('Run interrupted'));
    this.approvalTracker.clear();
    this.outputThrottler.flush(false);
    this.resetOutputState();
    this.activeOutputSegment = null;
    this.setStatus('idle');

    return hadActiveTurn || hadPendingRequests;
  }

  private normalizeQuestionAnswerInput(updatedInput?: Record<string, unknown>): string | string[] | Record<string, string | string[]> {
    if (!updatedInput) {
      return '';
    }

    const answers = updatedInput.answers;
    if (typeof answers === 'string' || Array.isArray(answers)) {
      return answers as string | string[];
    }

    if (answers && typeof answers === 'object') {
      const entries = Object.entries(answers as Record<string, unknown>);
      if (entries.length === 1 && entries[0]) {
        const onlyValue = entries[0][1];
        if (typeof onlyValue === 'string' || Array.isArray(onlyValue)) {
          return onlyValue as string | string[];
        }
      }

      const normalized: Record<string, string | string[]> = {};
      for (const [key, value] of entries) {
        if (typeof value === 'string' || Array.isArray(value)) {
          normalized[key] = value as string | string[];
        }
      }
      return normalized;
    }

    if (typeof updatedInput.question === 'string') {
      return updatedInput.question;
    }

    return '';
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.warn('[CodexSDK] Error during shutdown:', error);
      }
    }

    this.client = null;
    this.activeOutputSegment = null;
    this.approvalTracker.clear();
    this.resetOutputState();
    this.setStatus('idle');
  }
}
