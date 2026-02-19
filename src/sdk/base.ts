/**
 * Squire SDK Base Client
 *
 * Abstract base class for all SDK client implementations.
 * Provides common functionality and event emission patterns.
 */

import { EventEmitter } from 'events';
import {
  SDKConfig,
  SDKMessage,
  SDKToolResult,
  ToolUseEvent,
  ToolResultEvent,
  ApprovalEvent,
  OutputEvent,
  MetadataEvent,
  ClientStatus,
  PermissionMode,
} from './types.js';

// ============================================================================
// Output Throttler - Manages rate-limited output emission
// ============================================================================

export class OutputThrottler {
  private pendingStdout = '';
  private pendingThinking = '';
  private timer: NodeJS.Timeout | null = null;
  private readonly throttleMs: number;

  private lastEmittedStdout = '';
  private lastEmittedThinking = '';

  constructor(
    private readonly emit: (event: OutputEvent) => void,
    throttleMs: number = 500
  ) {
    this.throttleMs = throttleMs;
  }

  addStdout(content: string): void {
    this.pendingStdout = content;
    this.schedule();
  }

  addThinking(content: string): void {
    this.pendingThinking = content;
    this.schedule();
  }

  appendStdout(content: string): void {
    this.pendingStdout += content;
    this.schedule();
  }

  flush(isComplete: boolean = false): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    console.log(`[OutputThrottler] flush(isComplete=${isComplete}), pendingStdout=${this.pendingStdout?.length || 0}chars, pendingThinking=${this.pendingThinking?.length || 0}chars`);

    if (this.pendingStdout && this.pendingStdout !== this.lastEmittedStdout) {
      console.log(`[OutputThrottler] Emitting stdout: ${this.pendingStdout?.slice(0, 100)}...`);
      this.emit({
        content: this.pendingStdout,
        isComplete,
        outputType: 'stdout',
      });
      this.lastEmittedStdout = this.pendingStdout;
    }

    if (this.pendingThinking && this.pendingThinking !== this.lastEmittedThinking) {
      console.log(`[OutputThrottler] Emitting thinking: ${this.pendingThinking?.slice(0, 100)}...`);
      this.emit({
        content: this.pendingThinking,
        isComplete,
        outputType: 'thinking',
      });
      this.lastEmittedThinking = this.pendingThinking;
    }

    if (isComplete) {
      this.pendingStdout = '';
      this.pendingThinking = '';
      this.lastEmittedStdout = '';
      this.lastEmittedThinking = '';
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(false), this.throttleMs);
  }
}

// ============================================================================
// Message Queue - Ensures sequential message processing
// ============================================================================

interface QueuedMessage {
  message: SDKMessage;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private sending = false;

  constructor(private readonly sender: (message: SDKMessage) => Promise<void>) {}

  enqueue(message: SDKMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, resolve, reject });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;

    this.sending = true;
    const item = this.queue.shift()!;

    try {
      await this.sender(item.message);
      item.resolve();
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.sending = false;
      if (this.queue.length > 0) {
        this.drain();
      }
    }
  }

  isActive(): boolean {
    return this.sending;
  }

  clear(): void {
    this.queue = [];
  }
}

// ============================================================================
// Pending Approval Tracker
// ============================================================================

export interface PendingApprovalEntry {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  createdAt: number;
}

export class PendingApprovalTracker<T extends PendingApprovalEntry = PendingApprovalEntry> {
  private pending = new Map<string, T>();

  add(approvalId: string, entry: T): void {
    this.pending.set(approvalId, { ...entry, createdAt: Date.now() });
  }

  get(approvalId: string): T | undefined {
    return this.pending.get(approvalId);
  }

  delete(approvalId: string): boolean {
    return this.pending.delete(approvalId);
  }

  has(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }

  size(): number {
    return this.pending.size;
  }

  firstKey(): string | undefined {
    return this.pending.keys().next().value;
  }

  clear(): void {
    this.pending.clear();
  }
}

// ============================================================================
// Base SDK Client
// ============================================================================

export type SDKClientEventMap = {
  output: [OutputEvent];
  tool_use: [ToolUseEvent];
  tool_result: [ToolResultEvent];
  approval: [ApprovalEvent];
  approval_canceled: [string];
  metadata: [MetadataEvent];
  complete: [];
  error: [Error];
  status: [ClientStatus];
};

export abstract class BaseSDKClient extends EventEmitter<SDKClientEventMap> {
  protected config: SDKConfig;
  protected _status: ClientStatus = 'idle';
  protected outputThrottler: OutputThrottler;
  protected messageQueue: MessageQueue;
  protected approvalTracker: PendingApprovalTracker;

  abstract readonly provider: string;

  constructor(config: SDKConfig) {
    super();
    this.config = config;

    this.outputThrottler = new OutputThrottler((output) => {
      this.emit('output', output);
    }, 500);

    this.messageQueue = new MessageQueue((msg) => this.doSendMessage(msg));

    this.approvalTracker = new PendingApprovalTracker();
  }

  // Abstract methods that subclasses must implement
  protected abstract doSendMessage(message: SDKMessage): Promise<void>;
  abstract sendToolResult(result: SDKToolResult): Promise<void>;
  abstract sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>
  ): Promise<void>;
  abstract close(): Promise<void>;

  // Optional methods with default implementations
  async start(): Promise<void> {
    // Override in subclass if needed
  }

  async sendMessageWithImages(
    text: string,
    images: Array<{ data: string; mediaType: string }>
  ): Promise<void> {
    return this.sendMessage({ role: 'user', content: text, images });
  }

  // Public API
  get status(): ClientStatus {
    return this._status;
  }

  protected setStatus(status: ClientStatus): void {
    this._status = status;
    this.emit('status', status);
  }

  sendMessage(message: SDKMessage): Promise<void> {
    return this.messageQueue.enqueue(message);
  }

  get permissionMode(): PermissionMode {
    return this.config.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.config.permissionMode = mode;
  }

  hasPendingApprovals(): boolean {
    return this.approvalTracker.size() > 0;
  }

  getFirstPendingApprovalId(): string | undefined {
    return this.approvalTracker.firstKey();
  }

  // Helper to emit output
  protected emitOutput(content: string, isComplete: boolean, outputType: 'stdout' | 'thinking'): void {
    this.outputThrottler.addStdout(content);
    if (isComplete) {
      this.outputThrottler.flush(true);
    }
  }

  // Helper to emit thinking
  protected emitThinking(content: string, isComplete: boolean): void {
    this.outputThrottler.addThinking(content);
    if (isComplete) {
      this.outputThrottler.flush(true);
    }
  }

  // Helper to emit error
  protected emitError(error: Error): void {
    this.emit('error', error);
    this.setStatus('error');
  }
}
