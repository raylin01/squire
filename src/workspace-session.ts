/**
 * Workspace Session - Manages SDK client per workspace
 *
 * Each workspace has its own SDK client instance with its own:
 * - Working directory (cwd)
 * - Conversation history
 * - Session state (including CLI session ID for persistence)
 */

import { EventEmitter } from 'events';
import type { Workspace, SDKProvider } from './types.js';
import { createSDKClient, BaseSDKClient } from './sdk/index.js';
import type { SDKMessage, OutputEvent, ToolUseEvent, ApprovalEvent } from './sdk/types.js';

export interface WorkspaceSessionEvents {
  output: [OutputEvent & { workspaceId: string }];
  tool_use: [ToolUseEvent & { workspaceId: string }];
  approval: [ApprovalEvent & { workspaceId: string }];
  complete: [{ workspaceId: string }];
  error: [Error & { workspaceId: string }];
  status: [{ workspaceId: string; status: string }];
  /** Emitted when CLI session ID changes (for persistence) */
  session_id: [{ workspaceId: string; cliSessionId: string }];
}

/**
 * WorkspaceSession
 *
 * Wraps a Workspace and manages its dedicated SDK client.
 */
export class WorkspaceSession extends EventEmitter<WorkspaceSessionEvents> {
  private workspace: Workspace;
  private sdkClient: BaseSDKClient | null = null;
  private sdkProvider: SDKProvider;
  private permissionMode: 'strict' | 'autoSafe' | 'permissive';
  private model?: string;
  private cliPath?: string;
  private running: boolean = false;

  constructor(
    workspace: Workspace,
    options: {
      provider: SDKProvider;
      permissionMode: 'strict' | 'autoSafe' | 'permissive';
      model?: string;
      cliPath?: string;
    }
  ) {
    super();
    this.workspace = workspace;
    this.sdkProvider = options.provider;
    this.permissionMode = options.permissionMode;
    this.model = options.model;
    this.cliPath = options.cliPath;
  }

  get workspaceId(): string {
    return this.workspace.workspaceId;
  }

  get projectPath(): string {
    // Priority: projectPath > sandboxPath > process.cwd()
    return this.workspace.context?.projectPath
      || this.workspace.context?.sandboxPath
      || process.cwd();
  }

  getWorkspace(): Workspace {
    return this.workspace;
  }

  updateWorkspace(updates: Partial<Workspace>): void {
    this.workspace = { ...this.workspace, ...updates };
  }

  /**
   * Initialize the SDK client for this workspace
   */
  async start(): Promise<void> {
    if (this.running && this.sdkClient) {
      return;
    }

    // Ensure sandbox directory exists
    const cwd = this.projectPath;
    if (cwd && cwd.includes('.squirebot/workspaces')) {
      const fs = await import('fs');
      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
        console.log(`[WorkspaceSession] Created sandbox directory: ${cwd}`);
      }
    }
    const resumeSessionId = this.workspace.context?.cliSessionId;

    console.log(`[WorkspaceSession] Starting SDK for workspace ${this.workspaceId.slice(0, 8)}... in ${cwd}`);
    if (resumeSessionId) {
      console.log(`[WorkspaceSession] Resuming session: ${resumeSessionId.slice(0, 8)}...`);
    }

    this.sdkClient = createSDKClient({
      provider: this.sdkProvider,
      model: this.model,
      cwd,
      permissionMode: this.permissionMode,
      cliPath: this.cliPath,
      resumeSessionId, // Resume previous conversation if available
    });

    this.setupEventListeners();
    await this.sdkClient.start();
    this.running = true;

    console.log(`[WorkspaceSession] SDK started for workspace ${this.workspaceId.slice(0, 8)}...`);
  }

  /**
   * Set up event listeners to forward SDK events with workspace context
   */
  private setupEventListeners(): void {
    if (!this.sdkClient) return;

    // Forward output events
    this.sdkClient.on('output', (output) => {
      this.emit('output', {
        ...output,
        workspaceId: this.workspaceId,
      });
    });

    // Forward tool use events
    this.sdkClient.on('tool_use', (event) => {
      this.emit('tool_use', {
        ...event,
        workspaceId: this.workspaceId,
      });
    });

    // Forward approval events
    this.sdkClient.on('approval', (event) => {
      this.emit('approval', {
        ...event,
        workspaceId: this.workspaceId,
      });
    });

    // Forward complete events
    this.sdkClient.on('complete', () => {
      this.emit('complete', { workspaceId: this.workspaceId });
    });

    // Forward error events
    this.sdkClient.on('error', (error) => {
      const workspaceError = error as Error & { workspaceId: string };
      workspaceError.workspaceId = this.workspaceId;
      this.emit('error', workspaceError);
    });

    // Forward status events
    this.sdkClient.on('status', (status) => {
      this.emit('status', { workspaceId: this.workspaceId, status });
    });

    // Listen for metadata events to capture session ID
    this.sdkClient.on('metadata', (metadata: any) => {
      // SDK may emit session ID in metadata
      if (metadata.sessionId || metadata.session_id) {
        const cliSessionId = metadata.sessionId || metadata.session_id;
        // Update workspace context
        this.workspace.context = {
          ...this.workspace.context,
          cliSessionId,
        };
        // Emit event for persistence
        this.emit('session_id', { workspaceId: this.workspaceId, cliSessionId });
        console.log(`[WorkspaceSession] Captured CLI session ID: ${cliSessionId.slice(0, 8)}...`);
      }
    });
  }

  /**
   * Send a message to the SDK
   */
  async sendMessage(message: SDKMessage): Promise<void> {
    if (!this.sdkClient || !this.running) {
      await this.start();
    }

    if (!this.sdkClient) {
      throw new Error(`SDK client not initialized for workspace ${this.workspaceId}`);
    }

    await this.sdkClient.sendMessage(message);
  }

  /**
   * Send a message with images to the SDK
   */
  async sendMessageWithImages(
    text: string,
    images: Array<{ data: string; mediaType: string }>
  ): Promise<void> {
    if (!this.sdkClient || !this.running) {
      await this.start();
    }

    if (!this.sdkClient) {
      throw new Error(`SDK client not initialized for workspace ${this.workspaceId}`);
    }

    await this.sdkClient.sendMessageWithImages(text, images);
  }

  /**
   * Send tool result back to SDK
   */
  async sendToolResult(result: { toolUseId: string; content: string; isError?: boolean }): Promise<void> {
    if (!this.sdkClient) return;
    await this.sdkClient.sendToolResult(result);
  }

  /**
   * Send approval decision to SDK
   */
  async sendApproval(requestId: string, decision: 'allow' | 'deny', updatedInput?: Record<string, unknown>): Promise<void> {
    if (!this.sdkClient) return;
    await this.sdkClient.sendApproval(requestId, decision, updatedInput);
  }

  /**
   * Check if session has pending approvals
   */
  hasPendingApprovals(): boolean {
    return this.sdkClient?.hasPendingApprovals() ?? false;
  }

  /**
   * Get first pending approval ID
   */
  getFirstPendingApprovalId(): string | undefined {
    return this.sdkClient?.getFirstPendingApprovalId();
  }

  /**
   * Stop the SDK client
   */
  async stop(): Promise<void> {
    if (this.sdkClient) {
      await this.sdkClient.close();
      this.sdkClient = null;
    }
    this.running = false;
    console.log(`[WorkspaceSession] Stopped SDK for workspace ${this.workspaceId.slice(0, 8)}...`);
  }

  /**
   * Check if session is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
