/**
 * Squire - Personal AI Assistant
 *
 * Main Squire class that coordinates all subsystems.
 */

import { EventEmitter } from 'events';
import path from 'path';
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
} from './types.js';
import { resolveConfig, ensureSquireDir } from './config.js';
import { MemoryManager, createMemoryManager } from './memory/index.js';
import { SkillManager, createSkillManager } from './skills/index.js';
import { Scheduler, createScheduler } from './scheduler/index.js';

/**
 * Squire - The main personal AI assistant class
 */
export class Squire extends EventEmitter {
  private config: SquireConfig;
  private workspaces: Map<string, Workspace> = new Map();
  private activeWorkspaceId: string | null = null;
  private running: boolean = false;

  // Subsystems
  private memoryManager: MemoryManager | null = null;
  private skillManager: SkillManager | null = null;
  private scheduler: Scheduler | null = null;
  private ticketManager: unknown = null;

  constructor(config: Partial<SquireConfig> & { squireId: string }) {
    super();
    this.config = resolveConfig(config);
    ensureSquireDir();
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

    // Load existing workspaces from storage
    await this.loadWorkspaces();

    // Initialize memory system (Phase 2)
    if (this.config.memory.enabled) {
      this.memoryManager = createMemoryManager(this.config.memory, this.config.dataDir);
      try {
        await this.memoryManager.initialize();
        console.log('[Squire] Memory system initialized');
      } catch (error) {
        console.error('[Squire] Failed to initialize memory system:', error);
        this.memoryManager = null;
      }
    }

    // Load skills (Phase 3)
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

    // Start scheduler if daemon mode (Phase 4)
    if (this.config.daemonMode) {
      this.scheduler = createScheduler({
        dbPath: path.join(this.config.dataDir, 'scheduler.db'),
        pollInterval: this.config.pollInterval,
      });

      // Set up task executor
      this.scheduler.setExecutor(async (task) => {
        return this.executeScheduledTask(task);
      });

      this.scheduler.start();
      console.log('[Squire] Scheduler started (daemon mode)');
    }

    this.running = true;
    this.emitEvent('squire_started', { squireId: this.config.squireId });
    console.log(`[Squire] ${this.config.name} started successfully`);
  }

  /**
   * Stop the Squire instance
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log(`[Squire] Stopping ${this.config.name}...`);

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler.close();
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
      source: options?.source,
      workspaceId: options?.workspaceId,
      metadata: options?.metadata,
    });

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

    // Update workspace activity
    workspace.lastActivityAt = new Date().toISOString();

    // TODO: Build context with memory
    // TODO: Build system prompt with skills
    // TODO: Call LLM API
    // TODO: Process tool calls
    // TODO: Store in memory if needed

    const message: SquireMessage = {
      role: 'assistant',
      content: 'TODO: Implement LLM integration',
      workspaceId,
      timestamp: new Date().toISOString(),
    };

    this.emitEvent('message_sent', { message });
    return message;
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
    // TODO: Load from storage
    console.log('[Squire] Loading workspaces...');
  }

  private async saveWorkspaces(): Promise<void> {
    // TODO: Save to storage
    console.log('[Squire] Saving workspaces...');
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
