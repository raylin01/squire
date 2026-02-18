/**
 * Squire - Personal AI Assistant
 *
 * Main Squire class that coordinates all subsystems.
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import type {
  SquireConfig,
  Workspace,
  WorkspaceSource,
  MemoryEntry,
  MemorySearchResult,
  MemorySource,
  ScheduledTask,
  TaskSchedule,
  Skill,
  SquireMessage,
  SquireEvent,
  SquireEventHandler,
  SquireEventType,
  CreateWorkspaceOptions,
  RememberOptions,
  ScheduleTaskOptions,
  SDKProvider,
} from './types.js';
import { resolveConfig, ensureSquireDir } from './config.js';
import { HybridMemoryManager, createHybridMemoryManager } from './memory/index.js';
import type { MemoryAddOptions, CoreMemoryType } from './memory/types.js';
import { SkillManager, createSkillManager } from './skills/index.js';
import { Scheduler, createScheduler } from './scheduler/index.js';
import { TicketManager, createTicketManager } from './tickets/index.js';
import { PersonalityManager, createPersonalityManager } from './personality/index.js';
import { createSDKClient, BaseSDKClient } from './sdk/index.js';
import { toolRegistry, setCommunicationHandler, communicate, setSelfManageState, setMemoryManager as setToolMemoryManager, setScheduler as setToolScheduler, setTicketManager as setToolTicketManager, setSquireInstance } from './tools/index.js';
import { checkBashPermission, checkToolPermission } from './permissions/index.js';

/**
 * Squire - The main personal AI assistant class
 */
export class Squire extends EventEmitter {
  private config: SquireConfig;
  private workspaces: Map<string, Workspace> = new Map();
  private activeWorkspaceId: string | null = null;
  private running: boolean = false;

  // Subsystems
  private memoryManager: HybridMemoryManager | null = null;
  private skillManager: SkillManager | null = null;
  private scheduler: Scheduler | null = null;
  private ticketManager: TicketManager | null = null;
  private personalityManager: PersonalityManager | null = null;

  // SDK Client
  private sdkClient: BaseSDKClient | null = null;

  // Heartbeat/activity tracking
  private lastHeartbeat: Date = new Date();
  private currentActivity: string = 'idle';

  constructor(config: Partial<SquireConfig> & { squireId: string }) {
    super();
    this.config = resolveConfig(config);
    ensureSquireDir();
    this.setupToolHandlers();
  }

  /**
   * Set up tool handlers to connect tools to Squire functionality
   */
  private setupToolHandlers(): void {
    // Communication handler - connects squire_communicate to actual output
    setCommunicationHandler(async (options) => {
      this.emitEvent('communication', {
        type: options.type,
        content: options.content,
        title: options.title,
        color: options.color,
        ping: options.ping,
      });
      return `Message sent: ${options.type}`;
    });

    // Self-management state
    setSelfManageState({
      restart: async () => {
        await this.stop();
        process.exit(0); // External process manager should restart
      },
      switchSDK: async (provider: SDKProvider) => {
        await this.switchSDK(provider);
      },
      updateConfig: async (updates: Record<string, unknown>) => {
        this.config = { ...this.config, ...updates } as SquireConfig;
      },
      reloadSkills: async () => {
        if (this.skillManager) {
          await this.skillManager.initialize();
        }
      },
      getConfig: () => ({ ...this.config }) as Record<string, unknown>,
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the Squire instance
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[Squire] Already running');
      return;
    }

    console.log(`[Squire] Starting ${this.config.name}...`);
    this.updateActivity('starting');

    // Load existing workspaces from storage
    await this.loadWorkspaces();

    // Initialize SDK client
    await this.initializeSDK();

    // Initialize memory system (use hybrid memory manager)
    if (this.config.memory.enabled) {
      try {
        // Use HybridMemoryManager for enhanced memory features
        this.memoryManager = createHybridMemoryManager({
          config: this.config.memory,
          dataDir: this.config.dataDir,
          squireName: this.config.name,
        });
        await this.memoryManager.initialize();
        setToolMemoryManager(this.memoryManager as HybridMemoryManager);
        console.log('[Squire] Hybrid memory system initialized');
      } catch (error) {
        console.error('[Squire] Failed to initialize memory system:', error);
        this.memoryManager = null;
      }
    }

    // Load skills
    this.skillManager = createSkillManager({
      config: this.config.skills,
      skillsDir: this.config.skillsDir,
    });
    try {
      await this.skillManager.initialize();
      console.log('[Squire] Skills system initialized');
    } catch (error) {
      console.error('[Squire] Failed to initialize skills system:', error);
      this.skillManager = null;
    }

    // Initialize ticket manager
    const ticketsDbPath = path.join(this.config.dataDir, 'tickets.db');
    this.ticketManager = createTicketManager(ticketsDbPath);
    setToolTicketManager(this.ticketManager);

    // Initialize personality manager
    this.personalityManager = createPersonalityManager(this.config.personality);
    console.log('[Squire] Personality system initialized');

    // Start scheduler if daemon mode
    if (this.config.daemonMode) {
      this.scheduler = createScheduler({
        dbPath: path.join(this.config.dataDir, 'scheduler.db'),
        pollInterval: this.config.pollInterval,
      });

      setToolScheduler(this.scheduler);

      // Set up task executor
      this.scheduler.setExecutor(async (task) => {
        return this.executeScheduledTask(task);
      });

      this.scheduler.start();
      console.log('[Squire] Scheduler started (daemon mode)');
    }

    // Set squire instance for self-modification tools
    setSquireInstance({
      getConfig: () => this.config,
      getPersonalityManager: () => this.personalityManager,
    });

    this.running = true;
    this.updateActivity('ready');
    this.emitEvent('squire_started', { squireId: this.config.squireId });
    console.log(`[Squire] ${this.config.name} started successfully`);
  }

  /**
   * Initialize the SDK client
   */
  private async initializeSDK(): Promise<void> {
    try {
      this.sdkClient = createSDKClient({
        provider: this.config.sdk.provider,
        model: this.config.sdk.model || this.config.model,
        cwd: process.cwd(),
        permissionMode: this.config.permissions.mode,
        cliPath: this.config.sdk.cliPath,
      });

      // Set up SDK event handlers
      this.sdkClient.on('output', (output) => {
        this.lastHeartbeat = new Date();
        // Emit output event for Discord routing
        // Note: output.outputType can be 'stdout' or 'thinking'
        if (this.activeWorkspaceId) {
          this.emitEvent('output', {
            workspaceId: this.activeWorkspaceId,
            content: output.content,
            outputType: output.outputType || 'stdout',
            isComplete: output.isComplete || false,
          });
        }
      });

      this.sdkClient.on('tool_use', async (event) => {
        this.updateActivity(`using ${event.toolName}`);
        await this.handleToolUse(event);
      });

      this.sdkClient.on('approval', async (event) => {
        this.updateActivity('awaiting approval');
        await this.handleApproval(event);
      });

      this.sdkClient.on('complete', () => {
        this.updateActivity('ready');
        // Emit complete event with workspaceId
        if (this.activeWorkspaceId) {
          this.emitEvent('complete', {
            workspaceId: this.activeWorkspaceId,
          });
        }
      });

      this.sdkClient.on('error', (error) => {
        console.error('[Squire] SDK error:', error);
        this.updateActivity('error');
      });

      // Start the SDK client (spawns the underlying process)
      await this.sdkClient.start();

      console.log(`[Squire] SDK initialized: ${this.config.sdk.provider}`);
    } catch (error) {
      console.error('[Squire] Failed to initialize SDK:', error);
      throw error;
    }
  }

  /**
   * Switch to a different SDK provider
   */
  async switchSDK(provider: SDKProvider): Promise<void> {
    if (this.sdkClient) {
      await this.sdkClient.close();
    }

    this.config.sdk.provider = provider;
    await this.initializeSDK();
    console.log(`[Squire] Switched to ${provider} SDK`);
  }

  /**
   * Stop the Squire instance
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log(`[Squire] Stopping ${this.config.name}...`);
    this.updateActivity('stopping');

    // Close SDK client
    if (this.sdkClient) {
      await this.sdkClient.close();
    }

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler.close();
    }

    // Close ticket manager
    if (this.ticketManager) {
      this.ticketManager.close();
    }

    // Close memory manager
    if (this.memoryManager) {
      await this.memoryManager.close();
    }

    // Save workspaces
    await this.saveWorkspaces();

    this.running = false;
    this.emitEvent('squire_stopped', { squireId: this.config.squireId });
    console.log(`[Squire] ${this.config.name} stopped`);
  }

  /**
   * Check if Squire is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current configuration
   */
  getConfig(): SquireConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // Workspace Management
  // ==========================================================================

  /**
   * Create a new workspace
   */
  async createWorkspace(options: CreateWorkspaceOptions): Promise<Workspace> {
    const now = new Date().toISOString();

    const workspace: Workspace = {
      workspaceId: uuid(),
      name: options.name,
      source: options.source,
      sourceId: options.sourceId,
      createdAt: now,
      lastActivityAt: now,
      status: 'active',
      context: options.context || {},
    };

    this.workspaces.set(workspace.workspaceId, workspace);
    this.emitEvent('workspace_created', { workspace });
    await this.saveWorkspaces();

    console.log(`[Squire] Created workspace: ${workspace.name} (${workspace.workspaceId})`);
    return workspace;
  }

  /**
   * Get a workspace by ID
   */
  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Get a workspace by source type and ID
   */
  getWorkspaceBySource(source: WorkspaceSource, sourceId: string): Workspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.source === source && workspace.sourceId === sourceId) {
        return workspace;
      }
    }
    return undefined;
  }

  /**
   * Get all workspaces
   */
  getWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Set the active workspace
   */
  setActiveWorkspace(workspaceId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    this.activeWorkspaceId = workspaceId;
    workspace.lastActivityAt = new Date().toISOString();
    this.emitEvent('workspace_activated', { workspaceId });
  }

  /**
   * Get the active workspace
   */
  getActiveWorkspace(): Workspace | undefined {
    if (!this.activeWorkspaceId) {
      return undefined;
    }
    return this.workspaces.get(this.activeWorkspaceId);
  }

  /**
   * Update workspace status
   */
  updateWorkspaceStatus(workspaceId: string, status: Workspace['status']): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    workspace.status = status;
    workspace.lastActivityAt = new Date().toISOString();
    this.emitEvent('workspace_updated', { workspaceId, status });
  }

  // ==========================================================================
  // Memory (Phase 2)
  // ==========================================================================

  /**
   * Store a memory
   */
  async remember(content: string, options?: RememberOptions): Promise<MemoryEntry> {
    if (!this.config.memory.enabled) {
      throw new Error('Memory system is not enabled');
    }

    if (!this.memoryManager) {
      throw new Error('Memory manager not initialized');
    }

    const entry = await this.memoryManager.add(content, {
      type: options?.type as CoreMemoryType | undefined,
      source: options?.source,
      workspaceId: options?.workspaceId,
      tags: options?.tags,
      confidence: options?.confidence,
      evidence: options?.evidence,
    } as MemoryAddOptions);

    console.log(`[Squire] Remembered: ${content.slice(0, 50)}...`);
    this.emitEvent('memory_added', { entry });
    return entry;
  }

  /**
   * Search memories
   */
  async recall(query: string, limit?: number): Promise<MemorySearchResult[]> {
    if (!this.config.memory.enabled) {
      throw new Error('Memory system is not enabled');
    }

    if (!this.memoryManager) {
      throw new Error('Memory manager not initialized');
    }

    const results = await this.memoryManager.search(query, { limit });
    console.log(`[Squire] Recall query: ${query}, found ${results.length} results`);

    this.emitEvent('memory_searched', { query, limit, count: results.length });
    return results;
  }

  // ==========================================================================
  // Enhanced Memory Methods (Hybrid System)
  // ==========================================================================

  /**
   * Get memory overview
   */
  async getMemoryOverview(): Promise<string | null> {
    if (!this.memoryManager) {
      return null;
    }

    // Check if hybrid memory manager
    if ('getCoreMemoryOverview' in this.memoryManager) {
      const hybridManager = this.memoryManager as import('./memory/hybrid-manager.js').HybridMemoryManager;
      return hybridManager.getCoreMemoryOverview();
    }

    return null;
  }

  /**
   * Get today's daily summary
   */
  async getDailySummary(): Promise<string> {
    if (!this.memoryManager) {
      return 'Memory system not initialized.';
    }

    // Check if hybrid memory manager
    if ('generateDailySummary' in this.memoryManager) {
      const hybridManager = this.memoryManager as import('./memory/hybrid-manager.js').HybridMemoryManager;
      return hybridManager.generateDailySummary();
    }

    return 'Daily logs not available.';
  }

  /**
   * Get recent memory activity
   */
  async getRecentMemoryActivity(days: number = 7): Promise<{
    totalCommits: number;
    totalTasks: number;
    activeWorkspaces: string[];
    highlights: string[];
  } | null> {
    if (!this.memoryManager) {
      return null;
    }

    // Check if hybrid memory manager
    if ('getRecentActivity' in this.memoryManager) {
      const hybridManager = this.memoryManager as import('./memory/hybrid-manager.js').HybridMemoryManager;
      return hybridManager.getRecentActivity(days);
    }

    return null;
  }

  /**
   * Record a memory preference
   */
  async recordMemoryPreference(preference: string, workspaceId?: string): Promise<void> {
    if (!this.memoryManager) {
      throw new Error('Memory system not initialized');
    }

    if ('recordPreference' in this.memoryManager) {
      const hybridManager = this.memoryManager as import('./memory/hybrid-manager.js').HybridMemoryManager;
      await hybridManager.recordPreference(preference, { workspaceId });
    }
  }

  /**
   * Record a memory fact
   */
  async recordMemoryFact(fact: string, workspaceId?: string): Promise<void> {
    if (!this.memoryManager) {
      throw new Error('Memory system not initialized');
    }

    if ('recordFact' in this.memoryManager) {
      const hybridManager = this.memoryManager as import('./memory/hybrid-manager.js').HybridMemoryManager;
      await hybridManager.recordFact(fact, { workspaceId });
    }
  }

  // ==========================================================================
  // Messaging
  // ==========================================================================

  /**
   * Send a message to a workspace
   */
  async sendMessage(workspaceId: string, content: string): Promise<SquireMessage> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    if (!this.sdkClient) {
      throw new Error('SDK client not initialized');
    }

    // Update workspace activity
    workspace.lastActivityAt = new Date().toISOString();
    this.setActiveWorkspace(workspaceId);
    this.updateActivity('thinking');

    // Build message with compact context
    let contextContent = content;

    // Add compact personality summary (not full prompt every time)
    if (this.personalityManager) {
      const personality = this.personalityManager.getPersonality(workspaceId);
      const traits = personality.traits;

      // Compact summary - just key traits
      const personalitySummary = `[You are ${this.config.name}. Tone: ${traits.tone}, Verbosity: ${traits.verbosity}, Technicality: ${traits.technicality}]`;
      contextContent = `${personalitySummary}\n\n${content}`;

      // Add custom instructions if present
      if (personality.customInstructions) {
        contextContent = `${personalitySummary}\n[Additional: ${personality.customInstructions}]\n\n${content}`;
      }
    }

    // Smart memory search - only when likely needed
    if (this.memoryManager && this.shouldSearchMemory(content)) {
      try {
        const relevantMemories = await this.memoryManager.search(content, { limit: 3 });
        if (relevantMemories.length > 0) {
          const memoryContext = relevantMemories
            .map((m: { entry: { content: string } }) => `• ${m.entry.content}`)
            .join('\n');
          contextContent = `[Relevant memories]\n${memoryContext}\n\n${contextContent}`;
        }
      } catch (error) {
        console.error('[Squire] Failed to search memory:', error);
      }
    }

    // Send to SDK
    await this.sdkClient.sendMessage({ role: 'user', content: contextContent });

    // Return message (actual response comes via events)
    const message: SquireMessage = {
      role: 'assistant',
      content: '', // Will be filled via events
      workspaceId,
      timestamp: new Date().toISOString(),
    };

    this.emitEvent('message_sent', { message });
    return message;
  }

  /**
   * Determine if a message likely needs memory context
   */
  private shouldSearchMemory(content: string): boolean {
    const lower = content.toLowerCase();

    // Keywords that suggest memory is relevant
    const memoryTriggers = [
      // Questions about past events
      'remember', 'recall', 'last time', 'before', 'previously', 'earlier',
      // Questions about preferences
      'my favorite', 'i prefer', 'i like', 'my preference', 'usually',
      // Questions about context
      'what did', 'when did', 'how did', 'where did', 'who did',
      // Reference to shared history
      'we discussed', 'we talked', 'you said', 'i told', 'i mentioned',
      // Continuation words
      'continue', 'resume', 'back to', 'again', 'more about',
    ];

    // Check if any trigger word is present
    for (const trigger of memoryTriggers) {
      if (lower.includes(trigger)) {
        return true;
      }
    }

    // Questions often need context
    if (lower.includes('?') && (
      lower.includes('what') ||
      lower.includes('how') ||
      lower.includes('why') ||
      lower.includes('when') ||
      lower.includes('where') ||
      lower.includes('who')
    )) {
      return true;
    }

    return false;
  }

  /**
   * Handle tool use from SDK
   */
  private async handleToolUse(event: { toolName: string; toolId: string; input: Record<string, unknown> }): Promise<void> {
    if (!this.sdkClient) return;

    // Check if this is a built-in Squire tool
    if (toolRegistry.has(event.toolName)) {
      try {
        const result = await toolRegistry.execute(event.toolName, event.input);
        await this.sdkClient.sendToolResult({
          toolUseId: event.toolId,
          content: result,
        });
      } catch (error) {
        await this.sdkClient.sendToolResult({
          toolUseId: event.toolId,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        });
      }
    }
    // For bash commands, check permissions
    else if (event.toolName === 'bash' || event.toolName === 'Bash') {
      const command = event.input.command as string;
      const permissionReason = checkBashPermission(command, this.config.permissions.mode);

      if (permissionReason) {
        // Needs approval - will be handled by approval event
        return;
      }

      // Auto-approved, let SDK handle execution
    }
  }

  /**
   * Handle approval request from SDK
   */
  private async handleApproval(event: { requestId: string; toolName: string; toolInput: Record<string, unknown> }): Promise<void> {
    if (!this.sdkClient) return;

    const permissionReason = this.checkPermissionNeeded(event.toolName, event.toolInput);

    if (!permissionReason) {
      // Auto-approve
      await this.sdkClient.sendApproval(event.requestId, 'allow');
      return;
    }

    // Emit approval event for external handling (e.g., Discord, CLI)
    this.emitEvent('approval_required', {
      requestId: event.requestId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      reason: permissionReason,
      workspaceId: this.activeWorkspaceId,
    });
  }

  /**
   * Check if a tool use needs permission
   */
  private checkPermissionNeeded(toolName: string, input: Record<string, unknown>): string | null {
    const mode = this.config.permissions.mode;

    // Check blocked tools
    if (this.config.permissions.blockedTools.includes(toolName)) {
      return `${toolName} is blocked`;
    }

    // Check allowed tools
    if (this.config.permissions.allowedTools.includes(toolName)) {
      return null;
    }

    // Check bash permissions
    if (toolName === 'bash' || toolName === 'Bash') {
      const command = input.command as string;
      return checkBashPermission(command, mode);
    }

    // Check general tool permissions
    return checkToolPermission(toolName, input, mode);
  }

  /**
   * Respond to an approval request
   */
  async respondToApproval(requestId: string, approved: boolean, updatedInput?: Record<string, unknown>): Promise<void> {
    if (!this.sdkClient) return;
    await this.sdkClient.sendApproval(requestId, approved ? 'allow' : 'deny', updatedInput);
  }

  // ==========================================================================
  // Status & Activity
  // ==========================================================================

  /**
   * Update current activity (for status display)
   */
  private updateActivity(activity: string): void {
    this.currentActivity = activity;
    this.lastHeartbeat = new Date();
    this.emitEvent('status', {
      activity,
      timestamp: this.lastHeartbeat.toISOString(),
      workspaceId: this.activeWorkspaceId,
    });
  }

  /**
   * Get current status
   */
  getStatus(): { running: boolean; activity: string; lastHeartbeat: string; sdk: string } {
    return {
      running: this.running,
      activity: this.currentActivity,
      lastHeartbeat: this.lastHeartbeat.toISOString(),
      sdk: this.config.sdk.provider,
    };
  }

  // ==========================================================================
  // Scheduling (Phase 4)
  // ==========================================================================

  /**
   * Schedule a task
   */
  async scheduleTask(options: ScheduleTaskOptions): Promise<ScheduledTask> {
    if (!this.config.daemonMode || !this.scheduler) {
      throw new Error('Scheduler requires daemon mode');
    }

    const task = this.scheduler.schedule(
      options.workspaceId,
      options.description,
      options.schedule
    );

    this.emitEvent('task_scheduled', { task });
    return task;
  }

  /**
   * Get scheduled tasks
   */
  getTasks(workspaceId?: string): ScheduledTask[] {
    if (!this.scheduler) {
      return [];
    }

    if (workspaceId) {
      return this.scheduler.getTasksByWorkspace(workspaceId);
    }

    return this.scheduler.getTasks();
  }

  /**
   * Cancel a scheduled task
   */
  async cancelTask(taskId: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }

    const cancelled = this.scheduler.cancel(taskId);
    if (!cancelled) {
      throw new Error(`Task not found: ${taskId}`);
    }

    console.log(`[Squire] Cancelled task: ${taskId}`);
  }

  /**
   * Execute a scheduled task (called by scheduler)
   */
  private async executeScheduledTask(task: ScheduledTask): Promise<{ success: boolean; output?: string; error?: string; completedAt: string }> {
    console.log(`[Squire] Executing scheduled task: ${task.description}`);

    try {
      // Get the workspace for this task
      const workspace = this.workspaces.get(task.workspaceId);
      if (!workspace) {
        return {
          success: false,
          error: `Workspace not found: ${task.workspaceId}`,
          completedAt: new Date().toISOString(),
        };
      }

      // Set as active workspace
      this.setActiveWorkspace(task.workspaceId);

      // TODO: Actually execute the task using the AI
      // For now, just return success
      return {
        success: true,
        output: `Executed: ${task.description}`,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
    }
  }

  // ==========================================================================
  // Skills (Phase 3)
  // ==========================================================================

  /**
   * Get loaded skills
   */
  getSkills(): Skill[] {
    if (!this.skillManager) {
      return [];
    }
    return this.skillManager.getSkills();
  }

  /**
   * Load a skill from path
   */
  async loadSkill(skillPath: string): Promise<Skill> {
    if (!this.skillManager) {
      throw new Error('Skills system not initialized');
    }
    return this.skillManager.loadSkill(skillPath);
  }

  /**
   * Get the personality manager
   */
  getPersonalityManager(): PersonalityManager | null {
    return this.personalityManager;
  }

  /**
   * Set workspace personality override
   */
  setWorkspacePersonality(workspaceId: string, personality: Partial<import('./types.js').Personality>): void {
    if (this.personalityManager) {
      this.personalityManager.setWorkspaceOverride(workspaceId, personality);
    }
  }

  /**
   * Clear workspace personality override
   */
  clearWorkspacePersonality(workspaceId: string): void {
    if (this.personalityManager) {
      this.personalityManager.clearWorkspaceOverride(workspaceId);
    }
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  /**
   * Emit a Squire event
   */
  emitEvent(type: SquireEventType, data: Record<string, unknown>): void {
    const event: SquireEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Emit to local listeners
    this.emit(type, event);
    this.emit('*', event);
  }

  /**
   * Subscribe to events
   */
  onEvent(event: SquireEventType | '*', handler: SquireEventHandler): this {
    super.on(event, handler);
    return this;
  }

  /**
   * Unsubscribe from events
   */
  offEvent(event: SquireEventType | '*', handler: SquireEventHandler): this {
    super.off(event, handler);
    return this;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async loadWorkspaces(): Promise<void> {
    const workspacesFile = path.join(this.config.dataDir, 'workspaces.json');

    try {
      if (fs.existsSync(workspacesFile)) {
        const data = fs.readFileSync(workspacesFile, 'utf-8');
        const workspacesData = JSON.parse(data) as Workspace[];

        for (const workspace of workspacesData) {
          this.workspaces.set(workspace.workspaceId, workspace);
        }

        console.log(`[Squire] Loaded ${workspacesData.length} workspaces from storage`);
      } else {
        console.log('[Squire] No existing workspaces file, starting fresh');
      }
    } catch (error) {
      console.error('[Squire] Failed to load workspaces:', error);
    }
  }

  private async saveWorkspaces(): Promise<void> {
    const workspacesFile = path.join(this.config.dataDir, 'workspaces.json');

    try {
      const workspacesData = Array.from(this.workspaces.values());
      fs.writeFileSync(workspacesFile, JSON.stringify(workspacesData, null, 2));
      console.log(`[Squire] Saved ${workspacesData.length} workspaces to storage`);
    } catch (error) {
      console.error('[Squire] Failed to save workspaces:', error);
    }
  }

  private calculateNextRun(schedule: TaskSchedule): string {
    const now = Date.now();

    switch (schedule.type) {
      case 'once':
        return new Date(schedule.value as number).toISOString();
      case 'interval':
        return new Date(now + (schedule.value as number)).toISOString();
      case 'cron':
        // TODO: Parse cron expression
        return new Date(now + 60000).toISOString();
      default:
        return new Date(now + 60000).toISOString();
    }
  }
}

// Re-export for convenience
export type { SquireConfig } from './types.js';

/**
 * Create a Squire instance with default configuration
 */
export function createSquire(config: Partial<SquireConfig> & { squireId: string }): Squire {
  return new Squire(config);
}
