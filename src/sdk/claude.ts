/**
 * Claude SDK Client Wrapper
 *
 * Uses the structured v0.3.0 claude-client API so Squire receives a single
 * normalized stream of text, thinking, tool, and approval state per turn.
 */

import { BaseSDKClient, PendingApprovalEntry, PendingApprovalTracker } from './base.js';
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
import type {
  ClaudeSendContentBlock,
  OpenRequest,
  QuestionRequest,
  StructuredClaudeClient,
  TurnUpdate,
} from '@raylin01/claude-client';

type OutputSegment = 'stdout' | 'thinking' | null;

interface ClaudePendingRequest extends PendingApprovalEntry {
  requestKind: OpenRequest['kind'];
  request: OpenRequest;
}

function isQuestionRequest(request: OpenRequest): request is QuestionRequest {
  return request.kind === 'question';
}

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
  private client: StructuredClaudeClient | null = null;
  private activeOutputSegment: OutputSegment = null;
  private turnWorkers = new Set<Promise<void>>();

  constructor(config: SDKConfig) {
    super(config);
    this.approvalTracker = new PendingApprovalTracker<ClaudePendingRequest>() as PendingApprovalTracker;
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      const { ClaudeClient } = await import('@raylin01/claude-client');
      this.client = await ClaudeClient.init({
        cwd: this.config.cwd || process.cwd(),
        claudePath: this.config.cliPath,
        debug: this.config.debug,
        env: {
          ...process.env,
          ...this.config.env,
        },
        model: this.config.model,
        resumeSessionId: this.config.resumeSessionId,
        permissionMode: this.getClaudePermissionMode(),
        mcpServers: this.getMergedMcpServers(),
      });

      this.attachRawLogging();

      const sessionId = this.client.sessionId || this.config.resumeSessionId;
      if (sessionId) {
        this.config.resumeSessionId = sessionId;
      }

      this.emit('metadata', {
        model: this.config.model,
        permissionMode: this.getClaudePermissionMode(),
        sessionId,
      });

      this.setStatus('idle');
    } catch (error) {
      console.warn('[ClaudeSDK] Could not initialize Claude client:', error);
      this.setStatus('error');
    }
  }

  private getMergedMcpServers(): Record<string, unknown> {
    const mcpServers = { ...(this.config.mcpServers || {}) } as Record<string, unknown>;
    if (this.config.toolBridge) {
      mcpServers[this.config.toolBridge.serverName] = {
        command: this.config.toolBridge.command,
        args: this.config.toolBridge.args,
        env: this.config.toolBridge.env,
      };
    }
    return mcpServers;
  }

  private getClaudePermissionMode(): 'acceptEdits' | 'default' {
    return this.config.permissionMode === 'permissive' ? 'acceptEdits' : 'default';
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

  private attachRawLogging(): void {
    if (!this.client) {
      return;
    }

    const raw = this.client.raw;

    raw.on('system', (message) => {
      this.logRawJsonl('system', message);
      if (this.client?.sessionId) {
        this.config.resumeSessionId = this.client.sessionId;
        this.emit('metadata', {
          model: (message as { model?: string }).model || this.config.model,
          permissionMode: (message as { permissionMode?: string }).permissionMode || this.getClaudePermissionMode(),
          sessionId: this.client.sessionId,
        });
      }
    });

    raw.on('control_request', (message) => {
      this.logRawJsonl('control_request', message);
    });
    raw.on('control_cancel_request', (message) => {
      this.logRawJsonl('control_cancel_request', message);
    });
    raw.on('tool_result', (message) => {
      this.logRawJsonl('tool_result', message);
    });
    raw.on('result', (message) => {
      this.logRawJsonl('result', message);
    });
    raw.on('error', (error) => {
      this.logRawJsonl('error', { message: error.message, stack: error.stack });
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
      const turn = this.client.send(this.toClaudeInput(message));
      const worker = this.consumeTurnUpdates(turn.updates());
      this.turnWorkers.add(worker);
      worker.finally(() => this.turnWorkers.delete(worker));
      this.logRawJsonl('sendMessage.accepted', { messageLength: message.content.length, turnId: turn.current().id });
    } catch (error) {
      this.logRawJsonl('sendMessage.error', { error: String(error) });
      console.error('[ClaudeSDK] Error sending message:', error);
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private toClaudeInput(message: SDKMessage): string | { content: ClaudeSendContentBlock[] } {
    if (!message.images || message.images.length === 0) {
      return message.content;
    }

    const content: ClaudeSendContentBlock[] = [
      { type: 'text', text: message.content },
      ...message.images.map((image) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.data,
        },
      })),
    ];

    return { content };
  }

  private async consumeTurnUpdates(updates: AsyncIterable<TurnUpdate>): Promise<void> {
    for await (const update of updates) {
      this.logRawJsonl('turn.update', {
        kind: update.kind,
        turnId: update.turnId,
        status: update.snapshot.status,
        currentOutputKind: update.snapshot.currentOutputKind,
        requestId: update.snapshot.currentMessage.requestId,
      });
      await this.handleTurnUpdate(update);
    }
  }

  private async handleTurnUpdate(update: TurnUpdate): Promise<void> {
    switch (update.kind) {
      case 'queued':
      case 'started':
        this.setStatus('working');
        return;
      case 'output':
        this.handleOutputUpdate(update);
        return;
      case 'tool_use':
        this.handleToolUseUpdate(update);
        return;
      case 'tool_result':
        this.activeOutputSegment = null;
        return;
      case 'request_opened':
        await this.handleRequestOpened(update);
        return;
      case 'request_closed':
        this.handleRequestClosed(update);
        return;
      case 'assistant_message':
        return;
      case 'completed':
        this.handleCompletedUpdate(update);
        return;
      case 'error':
        this.handleErroredUpdate(update);
        return;
      default:
        return;
    }
  }

  private handleOutputUpdate(update: TurnUpdate): void {
    const { currentOutputKind, text, thinking } = update.snapshot;

    if (currentOutputKind === 'text') {
      if (this.activeOutputSegment === 'thinking') {
        this.outputThrottler.flush(false);
        this.resetOutputState();
      }
      this.activeOutputSegment = 'stdout';
      if (text) {
        this.outputThrottler.addStdout(text);
      }
      return;
    }

    if (currentOutputKind === 'thinking') {
      if (this.activeOutputSegment === 'stdout') {
        this.outputThrottler.flush(false);
        this.resetOutputState();
      }
      this.activeOutputSegment = 'thinking';
      if (thinking) {
        this.outputThrottler.addThinking(thinking);
      }
    }
  }

  private handleToolUseUpdate(update: TurnUpdate): void {
    this.outputThrottler.flush(false);
    this.resetOutputState();
    this.activeOutputSegment = null;

    const latest = update.snapshot.history[update.snapshot.history.length - 1]?.toolUse;
    if (!latest) {
      return;
    }

    this.emit('tool_use', {
      toolName: latest.name,
      toolId: latest.id,
      input: latest.input,
    } as ToolUseEvent);
  }

  private async handleRequestOpened(update: TurnUpdate): Promise<void> {
    const request = this.getLatestRequest(update);
    if (!request) {
      return;
    }

    if (request.kind === 'tool_approval' && this.shouldAutoApprove(request)) {
      try {
        await this.client?.approveRequest(request.id, {
          updatedInput: request.input,
          message: 'Auto-approved',
        });
      } catch (error) {
        console.warn('[ClaudeSDK] Error auto-approving request:', error);
      }
      return;
    }

    this.outputThrottler.flush(false);
    this.resetOutputState();
    this.activeOutputSegment = null;

    this.trackOpenRequest(request);
    this.emit('approval', this.toApprovalEvent(request) as ApprovalEvent);
    this.setStatus('waiting');
  }

  private handleRequestClosed(update: TurnUpdate): void {
    const request = this.getLatestRequest(update);
    if (!request) {
      return;
    }

    if (this.approvalTracker.has(request.id)) {
      this.approvalTracker.delete(request.id);
      this.emit('approval_canceled', request.id);
    }

    this.setStatus(this.approvalTracker.size() > 0 ? 'waiting' : 'working');
  }

  private handleCompletedUpdate(update: TurnUpdate): void {
    const { currentOutputKind } = update.snapshot;
    if (currentOutputKind === 'text' || currentOutputKind === 'thinking') {
      this.outputThrottler.flush(true);
    } else {
      this.outputThrottler.flush(false);
      this.resetOutputState();
    }

    this.activeOutputSegment = null;
    this.setStatus('idle');
    this.emit('complete');
  }

  private handleErroredUpdate(update: TurnUpdate): void {
    this.outputThrottler.flush(false);
    this.activeOutputSegment = null;
    this.resetOutputState();
    const message = update.snapshot.currentMessage.content || 'Claude turn failed.';
    this.emitError(new Error(message));
  }

  private getLatestRequest(update: TurnUpdate): OpenRequest | null {
    const latest = update.snapshot.history[update.snapshot.history.length - 1]?.request;
    return latest || null;
  }

  private shouldAutoApprove(request: Extract<OpenRequest, { kind: 'tool_approval' }>): boolean {
    const toolName = request.toolName;
    const input = request.input || {};
    const permissionMode = this.config.permissionMode;
    const squireNativeTool = isSquireNativeTool(toolName);
    const shouldAutoApprove = squireNativeTool
      || permissionMode === 'permissive'
      || (permissionMode === 'autoSafe' && shouldAutoApproveInSafeMode(toolName, input));

    if (shouldAutoApprove) {
      console.log(`[ClaudeSDK] Auto-approving: ${toolName} (mode: ${permissionMode}${squireNativeTool ? ', squire-native' : ''})`);
      return true;
    }

    if (toolName === 'Bash' && input.command) {
      const reason = getDangerousReason(input.command as string);
      console.log(`[ClaudeSDK] Tool ${toolName} requires approval${reason ? `: ${reason}` : ''}`);
    }

    return false;
  }

  private trackOpenRequest(request: OpenRequest): void {
    const toolName = request.kind === 'tool_approval'
      ? request.toolName
      : request.kind === 'question'
        ? 'AskUserQuestion'
        : request.kind === 'hook'
          ? 'HookCallback'
          : `mcp:${request.serverName}`;

    const input = request.kind === 'tool_approval'
      ? request.input
      : request.kind === 'question'
        ? this.toLegacyQuestionInput(request)
        : request.kind === 'hook'
          ? request.input
          : { message: request.message };

    (this.approvalTracker as PendingApprovalTracker<ClaudePendingRequest>).add(request.id, {
      requestId: request.id,
      toolName,
      input,
      toolUseId: request.kind === 'tool_approval' ? request.toolUseId || '' : request.kind === 'hook' ? request.toolUseId || '' : '',
      createdAt: Date.now(),
      requestKind: request.kind,
      request,
    });
  }

  private toApprovalEvent(request: OpenRequest): ApprovalEvent {
    if (request.kind === 'tool_approval') {
      return {
        requestId: request.id,
        toolName: request.toolName,
        toolInput: request.input,
        context: request.decisionReason,
        options: request.suggestions.map((suggestion) => ({
          label: suggestion.description || request.toolName,
          description: suggestion.scope,
        })),
      };
    }

    if (request.kind === 'question') {
      return {
        requestId: request.id,
        toolName: 'AskUserQuestion',
        toolInput: this.toLegacyQuestionInput(request),
        context: request.prompt,
        options: request.questions.flatMap((question) =>
          question.options.map((option) => ({
            label: option.label,
            description: option.description,
          }))
        ),
      };
    }

    if (request.kind === 'hook') {
      return {
        requestId: request.id,
        toolName: 'HookCallback',
        toolInput: request.input,
      };
    }

    return {
      requestId: request.id,
      toolName: `mcp:${request.serverName}`,
      toolInput: { message: request.message },
    };
  }

  private toLegacyQuestionInput(request: QuestionRequest): Record<string, unknown> {
    const primaryQuestion = request.questions[0];
    return {
      question: primaryQuestion?.prompt || request.prompt,
      title: request.title,
      options: primaryQuestion?.options.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description,
      })) || [],
      multiSelect: request.multiSelect,
      hasOther: request.allowOther,
      questions: request.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.prompt,
        multiSelect: question.multiSelect,
        options: question.options.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
        })),
      })),
    };
  }

  async sendToolResult(result: SDKToolResult): Promise<void> {
    if (!this.client) return;

    try {
      this.logRawJsonl('sendToolResult.input', result);
      await this.client.raw.sendMessageWithContent([
        {
          type: 'tool_result',
          tool_use_id: result.toolUseId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        },
      ]);
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
    if (!this.client) {
      console.warn('[ClaudeSDK] sendApproval failed: client not initialized');
      return;
    }

    const pending = (this.approvalTracker as PendingApprovalTracker<ClaudePendingRequest>).get(requestId);
    if (!pending) {
      console.warn(`[ClaudeSDK] No pending approval for ${requestId}`);
      return;
    }

    try {
      if (decision === 'deny') {
        await this.client.denyRequest(requestId, 'Denied by user');
      } else if (isQuestionRequest(pending.request)) {
        await this.client.answerQuestion(requestId, this.normalizeQuestionAnswerInput(updatedInput));
      } else {
        await this.client.approveRequest(requestId, {
          updatedInput: updatedInput ?? pending.input ?? {},
          message: 'Approved',
        });
      }

      this.logRawJsonl('sendApproval.accepted', { requestId, decision });
      this.approvalTracker.delete(requestId);
      this.setStatus(this.approvalTracker.size() === 0 ? 'working' : 'waiting');
    } catch (error) {
      this.logRawJsonl('sendApproval.error', { requestId, decision, error: String(error) });
      console.warn('[ClaudeSDK] Error sending approval:', error);
    }
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
        this.client.close();
      } catch (error) {
        console.warn('[ClaudeSDK] Error during close:', error);
      }
    }
    this.client = null;
    this.activeOutputSegment = null;
    this.approvalTracker.clear();
    this.resetOutputState();
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
    await this.close();
    this.config.cwd = newCwd;
    await this.start();
    return true;
  }
}
