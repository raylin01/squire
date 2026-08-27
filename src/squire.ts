/**
 * Squire - Personal AI Assistant
 *
 * Main Squire class that coordinates all subsystems.
 */

import { EventEmitter } from 'events';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import type {
  SquireConfig,
  Workspace,
  WorkspaceSource,
  MemoryEntry,
  MemorySearchResult,
  MemorySource,
  ScheduledTask,
  ScheduledTaskPayload,
  TaskSchedule,
  TaskResult,
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
import { resolveConfig, ensureSquireDir, saveConfig, deepMergeObjects } from './config.js';
import { calculateNextRun } from './scheduler/parser.js';
import { HybridMemoryManager, createHybridMemoryManager } from './memory/index.js';
import type { MemoryAddOptions, CoreMemoryType } from './memory/types.js';
import { SkillManager, createSkillManager } from './skills/index.js';
import { Scheduler, createScheduler } from './scheduler/index.js';
import { TicketManager, createTicketManager } from './tickets/index.js';
import { PersonalityManager, createPersonalityManager } from './personality/index.js';
import { toolRegistry, setCommunicationHandler, communicate, setSelfManageState, setMemoryManager as setToolMemoryManager, setScheduler as setToolScheduler, setSchedulerWorkspaceAccessors, setTicketManager as setToolTicketManager, setSquireInstance, runWithExecutionContext, getExecutionContext } from './tools/index.js';
import { createToolLoader } from './tools/loader.js';
import { checkBashPermission, checkToolPermission } from './permissions/index.js';
import { addLearnedPattern } from './permissions/learned-patterns.js';
import { WorkspaceSession } from './workspace-session.js';
import type { SDKTool, MCPServerConfig, NativeToolBridgeConfig } from './sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ToolBridgeRequestBody {
  toolName?: string;
  input?: Record<string, unknown>;
  workspaceId?: string;
}

interface WorkspaceSwitchDetails {
  reason: 'provider' | 'model';
  switchedAt: string;
  fromProvider: SDKProvider;
  toProvider: SDKProvider;
  fromModel: string | null;
  toModel: string | null;
}

/**
 * Squire - The main personal AI assistant class
 */
export class Squire extends EventEmitter {
  private config: SquireConfig;
  private workspaces: Map<string, Workspace> = new Map();
  private workspaceSessions: Map<string, WorkspaceSession> = new Map();
  private activeWorkspaceId: string | null = null;
  private running: boolean = false;

  // Pending approvals (requestId -> approval info for learned patterns)
  private pendingApprovals: Map<string, {
    toolName: string;
    toolInput: Record<string, unknown>;
    workspaceId?: string;
  }> = new Map();

  // Subsystems
  private memoryManager: HybridMemoryManager | null = null;
  private skillManager: SkillManager | null = null;
  private scheduler: Scheduler | null = null;
  private ticketManager: TicketManager | null = null;
  private personalityManager: PersonalityManager | null = null;

  // Heartbeat/activity tracking
  private lastHeartbeat: Date = new Date();
  private currentActivity: string = 'idle';

  // Native tool bridge (MCP -> local tool registry)
  private toolBridgeServer: http.Server | null = null;
  private toolBridgeUrl: string | null = null;
  private toolBridgeToken: string | null = null;

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
      // Use execution context workspace (set during tool execution) or fall back to active
      const context = getExecutionContext();
      const targetWorkspaceId = context.workspaceId || this.activeWorkspaceId;

      this.emitEvent('communication', {
        workspaceId: targetWorkspaceId,
        type: options.type,
        content: options.content,
        title: options.title,
        color: options.color,
        ping: options.ping,
        filePath: options.filePath,
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
      switchModel: async (model: string) => {
        await this.switchModel(model);
      },
      updateConfig: async (updates: Record<string, unknown>) => {
        const previousProvider = this.config.sdk.provider;
        const previousModel = this.getConfiguredModel();
        const previousMode = this.config.permissions.mode;

        this.config = deepMergeObjects(this.config, updates) as SquireConfig;
        saveConfig(this.config);
        this.emitEvent('config_updated', { config: this.config });

        const nextProvider = this.config.sdk.provider;
        const nextModel = this.getConfiguredModel();
        const nextMode = this.config.permissions.mode;
        if (nextProvider !== previousProvider || nextModel !== previousModel || nextMode !== previousMode) {
          const details: WorkspaceSwitchDetails = {
            reason: nextProvider !== previousProvider ? 'provider' : 'model',
            switchedAt: new Date().toISOString(),
            fromProvider: previousProvider,
            toProvider: nextProvider,
            fromModel: previousModel || null,
            toModel: nextModel || null,
          };
          await this.rebuildWorkspaceSessions(details);
        }
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

    // Load external tools and expose full toolset to SDK providers.
    await this.initializeToolRegistry();
    await this.startNativeToolBridge();

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
      setSchedulerWorkspaceAccessors({
        getTimezone: (workspaceId: string) => this.getWorkspaceTimezone(workspaceId),
        setTimezone: async (workspaceId: string, timezone: string) => {
          await this.setWorkspaceTimezone(workspaceId, timezone);
        },
      });

      // Set up task executor
      this.scheduler.setExecutor(async (task) => {
        return this.executeScheduledTask(task);
      });
      this.scheduler.setLifecycleHandlers({
        onTaskCompleted: async (task, result) => {
          this.emitEvent('task_completed', { task, result });
        },
        onTaskAwaitingUser: async (task, result) => {
          this.emitEvent('task_failed', {
            task,
            result,
            parsedSummary: result.parsedSummary,
            suggestedFixes: result.suggestedFixes,
          });
        },
      });

      this.scheduler.start();
      console.log('[Squire] Scheduler started (daemon mode)');
    }

    // Create workspace sessions for loaded workspaces (SDK is lazy-initialized per workspace)
    for (const workspace of this.workspaces.values()) {
      this.createWorkspaceSession(workspace);
    }

    // Set squire instance for self-modification tools
    setSquireInstance({
      getConfig: () => this.config,
      getPersonalityManager: () => this.personalityManager,
      remember: (content: string, category?: string) => this.remember(content, {
        type: category === 'preferences' ? 'preference' : 'fact',
        source: 'squire',
      }),
    });

    this.running = true;
    this.updateActivity('ready');
    this.emitEvent('squire_started', { squireId: this.config.squireId });
    console.log(`[Squire] ${this.config.name} started successfully`);
  }

  private async initializeToolRegistry(): Promise<void> {
    try {
      const loader = createToolLoader({
        globalDir: this.config.tools.globalDir,
        projectDir: this.config.tools.projectDir,
      });
      toolRegistry.setToolLoader(loader);
      const loaded = await toolRegistry.loadExternalTools();
      console.log(`[Squire] Tools initialized (${toolRegistry.getAll().length} total, ${loaded.length} external)`);
    } catch (error) {
      console.error('[Squire] Failed to initialize external tools:', error);
      throw error;
    }
  }

  private async startNativeToolBridge(): Promise<void> {
    if (this.toolBridgeServer) {
      return;
    }

    this.toolBridgeToken = uuid();

    const server = http.createServer((req, res) => {
      if (!req.url || req.method !== 'POST' || req.url !== '/execute') {
        res.statusCode = 404;
        res.end();
        return;
      }

      const authHeader = req.headers.authorization || '';
      const expected = `Bearer ${this.toolBridgeToken}`;
      if (authHeader !== expected) {
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > 1_000_000) {
          req.destroy();
        }
      });

      req.on('end', async () => {
        let payload: ToolBridgeRequestBody;
        try {
          payload = body ? JSON.parse(body) as ToolBridgeRequestBody : {};
        } catch {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
          return;
        }

        const toolName = String(payload.toolName || '').trim();
        const input = (payload.input && typeof payload.input === 'object')
          ? payload.input as Record<string, unknown>
          : {};
        const workspaceId = payload.workspaceId ? String(payload.workspaceId) : undefined;

        if (!toolName || !toolRegistry.has(toolName)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` }));
          return;
        }

        try {
          console.log(`[Squire][ToolBridge] Executing ${toolName} (workspace: ${workspaceId || 'none'})`);
          const result = await runWithExecutionContext({ workspaceId }, () => Promise.race([
            toolRegistry.execute(toolName, input),
            new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error(`Tool execution timeout: ${toolName}`)), 30_000);
            }),
          ]));
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, result }));
          console.log(`[Squire][ToolBridge] Completed ${toolName}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: message }));
          console.error(`[Squire][ToolBridge] Failed ${toolName}: ${message}`);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Failed to determine tool bridge listen address.');
    }

    this.toolBridgeServer = server;
    this.toolBridgeUrl = `http://127.0.0.1:${address.port}`;
    console.log(`[Squire] Native tool bridge listening at ${this.toolBridgeUrl}`);
  }

  private async stopNativeToolBridge(): Promise<void> {
    if (!this.toolBridgeServer) {
      return;
    }

    const server = this.toolBridgeServer;
    this.toolBridgeServer = null;
    this.toolBridgeUrl = null;
    this.toolBridgeToken = null;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private buildWorkspaceToolRuntime(workspaceId: string): {
    tools: SDKTool[];
    mcpServers: Record<string, MCPServerConfig>;
    toolBridge?: NativeToolBridgeConfig;
  } {
    const tools = toolRegistry.getToolDefinitions();
    const configuredMcpServers = { ...(this.config.sdk.mcpServers || {}) } as Record<string, MCPServerConfig>;

    const mcpServerScriptPath = path.join(__dirname, 'mcp', 'squire-tool-mcp-server.js');
    if (!fs.existsSync(mcpServerScriptPath)) {
      throw new Error(`Missing MCP bridge server script: ${mcpServerScriptPath}`);
    }

    let toolBridge: NativeToolBridgeConfig | undefined;
    if (this.toolBridgeUrl && this.toolBridgeToken && tools.length > 0) {
      toolBridge = {
        serverName: 'squire',
        command: process.execPath,
        args: [mcpServerScriptPath],
        env: {
          SQUIRE_TOOL_BRIDGE_URL: this.toolBridgeUrl,
          SQUIRE_TOOL_BRIDGE_TOKEN: this.toolBridgeToken,
          SQUIRE_TOOL_WORKSPACE_ID: workspaceId,
          SQUIRE_TOOL_DEFINITIONS_JSON: JSON.stringify(tools),
        },
      };

      configuredMcpServers[toolBridge.serverName] = {
        command: toolBridge.command,
        args: toolBridge.args,
        env: toolBridge.env,
      };
    }

    return { tools, mcpServers: configuredMcpServers, toolBridge };
  }

  /**
   * Create a workspace session with its own SDK client
   */
  private createWorkspaceSession(workspace: Workspace): WorkspaceSession {
    const runtime = this.buildWorkspaceToolRuntime(workspace.workspaceId);
    const session = new WorkspaceSession(workspace, {
      provider: this.config.sdk.provider,
      permissionMode: this.config.permissions.mode,
      model: this.config.sdk.model || this.config.model,
      cliPath: this.config.sdk.cliPath,
      tools: runtime.tools,
      mcpServers: runtime.mcpServers,
      toolBridge: runtime.toolBridge,
      runtimeDir: path.join(this.config.dataDir, 'runtime', workspace.workspaceId),
      outputThrottleMs: this.config.sdk.outputThrottleMs,
    });

    // Set up event forwarding from session to Squire events
    session.on('output', async (output) => {
      this.lastHeartbeat = new Date();

      // Emit output event for Discord routing
      this.emitEvent('output', {
        workspaceId: output.workspaceId,
        content: output.content,
        outputType: output.outputType || 'stdout',
        isComplete: output.isComplete || false,
      });
    });

    session.on('tool_use', async (event) => {
      this.updateActivity(`using ${event.toolName}`);
      // Emit tool_use event for message breaking in Discord
      this.emitEvent('tool_use', { workspaceId: event.workspaceId, toolName: event.toolName });
      await this.handleToolUse(event, session);
    });

    session.on('approval', async (event) => {
      this.updateActivity('awaiting approval');
      await this.handleApproval(event, session);
    });

    session.on('complete', (data) => {
      this.updateActivity('ready');
      this.emitEvent('complete', { workspaceId: data.workspaceId });
    });

    session.on('error', (error) => {
      console.error(`[Squire] SDK error (${error.workspaceId?.slice(0, 8)}...):`, error);
      this.updateActivity('error');
    });

    session.on('status', (data) => {
      console.log(`[Squire] Session status (${data.workspaceId?.slice(0, 8)}...): ${data.status}`);
    });

    // Save CLI session ID for persistence
    session.on('session_id', async (data) => {
      console.log(`[Squire] Session ID captured (${data.workspaceId.slice(0, 8)}...): ${data.cliSessionId.slice(0, 8)}...`);
      // Save workspaces to persist the CLI session ID
      await this.saveWorkspaces();
    });

    this.workspaceSessions.set(workspace.workspaceId, session);
    console.log(`[Squire] Created session for workspace ${workspace.workspaceId.slice(0, 8)}...`);
    return session;
  }

  /**
   * Get or create a workspace session
   */
  private getOrCreateSession(workspaceId: string): WorkspaceSession | undefined {
    let session = this.workspaceSessions.get(workspaceId);
    if (!session) {
      const workspace = this.workspaces.get(workspaceId);
      if (workspace) {
        session = this.createWorkspaceSession(workspace);
      }
    } else {
      const runtime = this.buildWorkspaceToolRuntime(workspaceId);
      session.setToolRuntime({
        tools: runtime.tools,
        mcpServers: runtime.mcpServers,
        toolBridge: runtime.toolBridge,
        runtimeDir: path.join(this.config.dataDir, 'runtime', workspaceId),
      });
    }
    return session;
  }

  private getConfiguredModel(): string | undefined {
    return this.config.sdk.model || this.config.model;
  }

  private getWorkspaceSwitchSummaryPath(workspace: Workspace): string {
    const baseDir = workspace.context?.sandboxPath || path.join(this.config.dataDir, 'workspace-handoffs', workspace.workspaceId);
    const summaryDir = path.join(baseDir, '.squire');
    fs.mkdirSync(summaryDir, { recursive: true });
    return path.join(summaryDir, 'switch-handoff.md');
  }

  private buildWorkspaceSwitchSummary(workspace: Workspace, details: WorkspaceSwitchDetails): string {
    const projectPath = workspace.context?.projectPath || workspace.context?.sandboxPath || 'unknown';
    const recentFiles = workspace.context?.recentFiles?.length
      ? workspace.context.recentFiles.map((file) => `- ${file}`).join('\n')
      : '- none recorded';
    const currentTask = workspace.context?.currentTask || 'No current task recorded.';
    const previousSessionId = workspace.context?.cliSessionId || 'none';

    return [
      '# Squire SDK Switch Handoff',
      '',
      `Generated: ${details.switchedAt}`,
      `Reason: ${details.reason}`,
      '',
      '## Workspace',
      '',
      `- Name: ${workspace.name}`,
      `- Workspace ID: ${workspace.workspaceId}`,
      `- Source: ${workspace.source}`,
      `- Source ID: ${workspace.sourceId}`,
      `- Project Path: ${projectPath}`,
      '',
      '## Switch',
      '',
      `- Previous Provider: ${details.fromProvider}`,
      `- Next Provider: ${details.toProvider}`,
      `- Previous Model: ${details.fromModel || 'provider default'}`,
      `- Next Model: ${details.toModel || 'provider default'}`,
      `- Previous Session ID: ${previousSessionId}`,
      '',
      '## Continuity Notes',
      '',
      `- Current task: ${currentTask}`,
      '- Previous CLI session was closed before the switch and is not resumed automatically.',
      '- Use this handoff summary to continue the conversation with the new provider or model.',
      '',
      '## Recent Files',
      '',
      recentFiles,
      '',
    ].join('\n');
  }

  private prepareWorkspaceForSwitch(workspace: Workspace, details: WorkspaceSwitchDetails): void {
    const summaryPath = this.getWorkspaceSwitchSummaryPath(workspace);
    const summary = this.buildWorkspaceSwitchSummary(workspace, details);
    fs.writeFileSync(summaryPath, summary, 'utf8');

    workspace.context = {
      ...workspace.context,
      cliSessionId: undefined,
      sdkProvider: details.toProvider,
      sdkModel: details.toModel || undefined,
      pendingSwitchSummaryPath: summaryPath,
      lastSwitchSummaryPath: summaryPath,
      lastSwitchAt: details.switchedAt,
    };
  }

  private buildSwitchPrompt(workspace: Workspace): string | null {
    const summaryPath = workspace.context?.pendingSwitchSummaryPath;
    if (!summaryPath || !fs.existsSync(summaryPath)) {
      return null;
    }

    const summary = fs.readFileSync(summaryPath, 'utf8').trim();
    if (!summary) {
      return null;
    }

    return [
      '[SDK switch handoff]',
      'A previous session was closed because Squire switched provider or model.',
      `Handoff summary file: ${summaryPath}`,
      '',
      summary,
    ].join('\n');
  }

  private async clearPendingSwitchPrompt(workspace: Workspace): Promise<void> {
    if (!workspace.context?.pendingSwitchSummaryPath) {
      return;
    }

    workspace.context = {
      ...workspace.context,
      pendingSwitchSummaryPath: undefined,
    };

    await this.saveWorkspaces();
  }

  private async rebuildWorkspaceSessions(details: WorkspaceSwitchDetails): Promise<void> {
    const sessionsToRestart = new Set<string>();
    for (const [workspaceId, session] of this.workspaceSessions) {
      if (session.isRunning()) {
        sessionsToRestart.add(workspaceId);
      }
    }
    if (this.activeWorkspaceId) {
      sessionsToRestart.add(this.activeWorkspaceId);
    }

    for (const workspace of this.workspaces.values()) {
      this.prepareWorkspaceForSwitch(workspace, details);
    }
    await this.saveWorkspaces();

    for (const session of this.workspaceSessions.values()) {
      await session.stop();
    }
    this.workspaceSessions.clear();

    for (const workspace of this.workspaces.values()) {
      this.createWorkspaceSession(workspace);
    }

    for (const workspaceId of sessionsToRestart) {
      const session = this.workspaceSessions.get(workspaceId);
      if (session) {
        await session.start();
      }
    }
  }

  /**
   * Switch to a different SDK provider and rebuild workspace sessions.
   */
  async switchSDK(provider: SDKProvider): Promise<void> {
    if (this.config.sdk.provider === provider) {
      return;
    }

    const details: WorkspaceSwitchDetails = {
      reason: 'provider',
      switchedAt: new Date().toISOString(),
      fromProvider: this.config.sdk.provider,
      toProvider: provider,
      fromModel: this.getConfiguredModel() || null,
      toModel: this.getConfiguredModel() || null,
    };

    this.config.sdk.provider = provider;
    details.toModel = this.getConfiguredModel() || null;

    console.log(`[Squire] SDK provider changed to ${provider}, rebuilding workspace sessions...`);
    await this.rebuildWorkspaceSessions(details);
  }

  /**
   * Switch to a different model and rebuild workspace sessions.
   */
  async switchModel(model: string): Promise<void> {
    if (this.config.sdk.model === model || (!this.config.sdk.model && this.config.model === model)) {
      return;
    }

    const details: WorkspaceSwitchDetails = {
      reason: 'model',
      switchedAt: new Date().toISOString(),
      fromProvider: this.config.sdk.provider,
      toProvider: this.config.sdk.provider,
      fromModel: this.getConfiguredModel() || null,
      toModel: model,
    };

    this.config.sdk.model = model;
    console.log(`[Squire] Model changed to ${model}, rebuilding workspace sessions...`);
    await this.rebuildWorkspaceSessions(details);
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

    // Close all workspace sessions
    for (const [workspaceId, session] of this.workspaceSessions) {
      await session.stop();
    }
    this.workspaceSessions.clear();

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

    // Stop native tool bridge
    await this.stopNativeToolBridge();

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
      context: {
        ...(options.context || {}),
        sdkProvider: this.config.sdk.provider,
        sdkModel: this.getConfiguredModel(),
      },
    };

    this.workspaces.set(workspace.workspaceId, workspace);

    // Create a session for this workspace (SDK is lazy-initialized)
    this.createWorkspaceSession(workspace);

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
    // Note: Each workspace has its own SDK session, no need to change cwd
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

  /**
   * Get workspace timezone
   */
  getWorkspaceTimezone(workspaceId: string): string | undefined {
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.context?.timezone;
  }

  /**
   * Persist workspace timezone to workspace state and metadata file.
   */
  async setWorkspaceTimezone(workspaceId: string, timezone: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const normalized = this.normalizeTimezone(timezone);
    workspace.context = {
      ...workspace.context,
      timezone: normalized,
    };

    await this.syncWorkspaceMetadata(workspace);
    await this.saveWorkspaces();
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

    // Get or create the workspace session
    const session = this.getOrCreateSession(workspaceId);
    if (!session) {
      throw new Error(`Could not create session for workspace ${workspaceId}`);
    }

    // Update workspace activity
    workspace.lastActivityAt = new Date().toISOString();
    this.setActiveWorkspace(workspaceId);
    this.updateActivity('thinking');

    // Build message with compact context
    let contextContent = content;

    const switchPrompt = this.buildSwitchPrompt(workspace);
    if (switchPrompt) {
      contextContent = `${switchPrompt}\n\n[New user message]\n${contextContent}`;
    }

    // Add working directory context if workspace has a project path
    if (workspace.context?.projectPath) {
      contextContent = `[Working directory: ${workspace.context.projectPath}]\n\n${contextContent}`;
    }

    // Add compact personality summary (not full prompt every time)
    if (this.personalityManager) {
      const personality = this.personalityManager.getPersonality(workspaceId);
      const traits = personality.traits;

      // Compact summary - just key traits
      const personalitySummary = `[You are ${this.config.name}. Tone: ${traits.tone}, Verbosity: ${traits.verbosity}, Technicality: ${traits.technicality}]`;
      contextContent = `${personalitySummary}\n\n${contextContent}`;

      // Add custom instructions if present
      if (personality.customInstructions) {
        contextContent = `${personalitySummary}\n[Additional: ${personality.customInstructions}]\n\n${contextContent}`;
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

    // Send to workspace's SDK session
    await session.sendMessage({ role: 'user', content: contextContent });

    if (switchPrompt) {
      await this.clearPendingSwitchPrompt(workspace);
    }

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
   * Send a message with images to a workspace
   */
  async sendMessageWithImages(
    workspaceId: string,
    content: string,
    images: Array<{ data: string; mediaType: string }>
  ): Promise<SquireMessage> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    // Get or create the workspace session
    const session = this.getOrCreateSession(workspaceId);
    if (!session) {
      throw new Error(`Could not create session for workspace ${workspaceId}`);
    }

    // Update workspace activity
    workspace.lastActivityAt = new Date().toISOString();
    this.setActiveWorkspace(workspaceId);
    this.updateActivity('thinking');

    // Build message with compact context
    let contextContent = content;

    const switchPrompt = this.buildSwitchPrompt(workspace);
    if (switchPrompt) {
      contextContent = `${switchPrompt}\n\n[New user message]\n${contextContent}`;
    }

    // Add working directory context if workspace has a project path
    if (workspace.context?.projectPath) {
      contextContent = `[Working directory: ${workspace.context.projectPath}]\n\n${contextContent}`;
    }

    // Add compact personality summary
    if (this.personalityManager) {
      const personality = this.personalityManager.getPersonality(workspaceId);
      const traits = personality.traits;
      const personalitySummary = `[You are ${this.config.name}. Tone: ${traits.tone}, Verbosity: ${traits.verbosity}, Technicality: ${traits.technicality}]`;
      contextContent = `${personalitySummary}\n\n${contextContent}`;
    }

    // Send to workspace's SDK session with images
    await session.sendMessageWithImages(contextContent, images);

    if (switchPrompt) {
      await this.clearPendingSwitchPrompt(workspace);
    }

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
  private async handleToolUse(event: { toolName: string; toolId: string; input: Record<string, unknown>; workspaceId?: string }, session: WorkspaceSession): Promise<void> {
    // Check if this is a built-in Squire tool
    if (toolRegistry.has(event.toolName)) {
      try {
        const result = await runWithExecutionContext({ workspaceId: event.workspaceId }, () =>
          toolRegistry.execute(event.toolName, event.input)
        );
        await session.sendToolResult({
          toolUseId: event.toolId,
          content: result,
        });
      } catch (error) {
        await session.sendToolResult({
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
  private async handleApproval(event: { requestId: string; toolName: string; toolInput: Record<string, unknown>; workspaceId?: string }, session: WorkspaceSession): Promise<void> {
    const permissionReason = this.checkPermissionNeeded(event.toolName, event.toolInput);

    if (!permissionReason) {
      // Auto-approve
      await session.sendApproval(event.requestId, 'allow', event.toolInput);
      this.emitEvent('approval_auto', {
        requestId: event.requestId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        workspaceId: event.workspaceId || this.activeWorkspaceId,
      });
      return;
    }

    // Store pending approval info for later pattern recording
    this.pendingApprovals.set(event.requestId, {
      toolName: event.toolName,
      toolInput: event.toolInput,
      workspaceId: event.workspaceId || this.activeWorkspaceId || undefined,
    });

    // Emit approval event for external handling (e.g., Discord, CLI)
    this.emitEvent('approval_required', {
      requestId: event.requestId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      reason: permissionReason,
      workspaceId: event.workspaceId || this.activeWorkspaceId,
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

    if (toolName === 'AskUserQuestion') {
      return 'AskUserQuestion requires user input';
    }

    // Check general tool permissions
    return checkToolPermission(toolName, input, mode);
  }

  /**
   * Respond to an approval request
   */
  async respondToApproval(requestId: string, approved: boolean, workspaceId?: string, updatedInput?: Record<string, unknown>): Promise<void> {
    console.log(`[Squire] respondToApproval called: requestId=${requestId}, approved=${approved}, workspaceId=${workspaceId}`);
    // Find the session that has this approval pending
    const targetWorkspaceId = workspaceId || this.activeWorkspaceId;
    if (!targetWorkspaceId) {
      console.log(`[Squire] respondToApproval failed: no target workspace ID`);
      return;
    }

    const session = this.workspaceSessions.get(targetWorkspaceId);
    if (!session) {
      console.log(`[Squire] respondToApproval failed: no session for workspace ${targetWorkspaceId}`);
      return;
    }

    let resolvedUpdatedInput = updatedInput;

    // If approved, record the pattern for future auto-approval
    if (approved) {
      const pendingInfo = this.pendingApprovals.get(requestId);
      if (pendingInfo) {
        if (!resolvedUpdatedInput) {
          resolvedUpdatedInput = pendingInfo.toolInput;
        }
        // Record learned pattern for Bash commands
        if ((pendingInfo.toolName === 'Bash' || pendingInfo.toolName === 'bash') && pendingInfo.toolInput.command) {
          const command = pendingInfo.toolInput.command as string;
          addLearnedPattern(command);
        }
        this.pendingApprovals.delete(requestId);
      }
    } else {
      // Clean up on deny too
      this.pendingApprovals.delete(requestId);
    }

    await session.sendApproval(requestId, approved ? 'allow' : 'deny', resolvedUpdatedInput);
    this.updateActivity('working');
  }

  /**
   * Get the first pending approval ID for a workspace
   */
  getFirstPendingApprovalId(workspaceId: string): string | undefined {
    const session = this.workspaceSessions.get(workspaceId);
    if (!session) return undefined;
    return session.getFirstPendingApprovalId();
  }

  /**
   * Interrupt the current run for a workspace and reset its SDK session.
   */
  async interruptWorkspaceRun(workspaceId: string): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const session = this.workspaceSessions.get(workspaceId);
    if (!session) {
      return false;
    }

    const interrupted = await session.interrupt();

    workspace.context = {
      ...workspace.context,
      cliSessionId: undefined,
    };
    session.updateWorkspace(workspace);
    await this.saveWorkspaces();

    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.workspaceId === workspaceId) {
        this.pendingApprovals.delete(requestId);
      }
    }

    this.updateActivity('ready');
    this.emitEvent('run_interrupted', { workspaceId, interrupted });
    console.log(`[Squire] Interrupted workspace run: ${workspaceId}`);
    return interrupted;
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

    const workspace = this.workspaces.get(options.workspaceId);
    const timezone = options.timezone || workspace?.context?.timezone;
    if (options.timezone && workspace) {
      workspace.context = {
        ...workspace.context,
        timezone: this.normalizeTimezone(options.timezone),
      };
      await this.syncWorkspaceMetadata(workspace);
      await this.saveWorkspaces();
    }

    const task = this.scheduler.schedule(
      options.workspaceId,
      options.description,
      options.schedule,
      {
        payload: options.payload || {
          objective: options.description,
        },
        timezone,
      }
    );

    this.emitEvent('task_scheduled', { task });
    return task;
  }

  /**
   * Get one scheduled task
   */
  getTask(taskId: string): ScheduledTask | null {
    if (!this.scheduler) {
      return null;
    }
    return this.scheduler.getTask(taskId);
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

  async pauseTask(taskId: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    const paused = this.scheduler.pause(taskId);
    if (!paused) {
      throw new Error(`Task not found or not pausable: ${taskId}`);
    }
  }

  async resumeTask(taskId: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    const resumed = this.scheduler.resume(taskId);
    if (!resumed) {
      throw new Error(`Task not found or not resumable: ${taskId}`);
    }
  }

  async retryTask(taskId: string, options?: { autoFix?: boolean }): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    const queued = this.scheduler.retryNow(taskId, options);
    if (!queued) {
      throw new Error(`Task not found or not retryable: ${taskId}`);
    }
  }

  async skipTaskRun(taskId: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    const skipped = this.scheduler.skipCurrentRun(taskId);
    if (!skipped) {
      throw new Error(`Task not found or not skippable: ${taskId}`);
    }
  }

  async disableTask(taskId: string): Promise<void> {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    const disabled = this.scheduler.disable(taskId);
    if (!disabled) {
      throw new Error(`Task not found: ${taskId}`);
    }
  }

  /**
   * Execute a scheduled task (called by scheduler)
   */
  private async executeScheduledTask(task: ScheduledTask): Promise<TaskResult> {
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

      const previousFailure = task.result?.parsedSummary || task.result?.error;
      const timezone = task.timezone || workspace.context?.timezone || 'UTC';
      const autoFixMode = task.payload.autoFixRequested === true;
      const contextLines = [
        '[System] Scheduled Task Triggered',
        `Task ID: ${task.taskId}`,
        `Description: ${task.description}`,
        `Objective: ${task.payload.objective}`,
        `Timezone: ${timezone}`,
        `Scheduled by: scheduler`,
      ];

      if (task.payload.context) {
        contextLines.push(`Run context: ${task.payload.context}`);
      }
      if (previousFailure) {
        contextLines.push(`Previous failure summary: ${previousFailure}`);
      }
      if (autoFixMode) {
        contextLines.push('Mode: auto-fix then retry. Diagnose the failure and attempt safe remediation before completing.');
      }

      contextLines.push(
        '',
        'Execute this scheduled run now.',
        'If you need high-risk commands, request approval as usual.',
        'If the run fails, explain the failure clearly and propose concrete fixes.'
      );

      const systemPrompt = contextLines.join('\n');

      // sendMessage waits for the SDK turn to finish (Claude/Gemini/Codex await turn.done).
      await this.sendMessage(task.workspaceId, systemPrompt);

      return {
        success: true,
        output: `Triggered AI execution for: ${task.description}`,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        parsedSummary: `The scheduled run could not be started because: ${errorMessage}`,
        suggestedFixes: [
          'Retry now in case this was temporary.',
          'Check whether the workspace/channel still exists.',
          'Disable the task if it is no longer needed.',
        ],
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

  async saveWorkspaces(): Promise<void> {
    const workspacesFile = path.join(this.config.dataDir, 'workspaces.json');

    try {
      const workspacesData = Array.from(this.workspaces.values());
      fs.writeFileSync(workspacesFile, JSON.stringify(workspacesData, null, 2));

      for (const workspace of workspacesData) {
        await this.syncWorkspaceMetadata(workspace);
      }

      console.log(`[Squire] Saved ${workspacesData.length} workspaces to storage`);
    } catch (error) {
      console.error('[Squire] Failed to save workspaces:', error);
    }
  }

  private normalizeTimezone(timezone: string): string {
    try {
      const normalized = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
      if (!normalized) {
        throw new Error(`Invalid timezone: ${timezone}`);
      }
      return normalized;
    } catch {
      throw new Error(`Invalid timezone "${timezone}"`);
    }
  }

  private async syncWorkspaceMetadata(workspace: Workspace): Promise<void> {
    const sandboxPath = workspace.context?.sandboxPath;
    if (!sandboxPath) {
      return;
    }

    try {
      if (!fs.existsSync(sandboxPath)) {
        fs.mkdirSync(sandboxPath, { recursive: true });
      }

      const metadataPath = path.join(sandboxPath, '.workspace.json');
      const metadata = {
        version: 1,
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        source: workspace.source,
        sourceId: workspace.sourceId,
        timezone: workspace.context?.timezone || null,
        sdkProvider: workspace.context?.sdkProvider || this.config.sdk.provider,
        sdkModel: workspace.context?.sdkModel || this.getConfiguredModel() || null,
        cliSessionId: workspace.context?.cliSessionId || null,
        lastSwitchAt: workspace.context?.lastSwitchAt || null,
        lastSwitchSummaryPath: workspace.context?.lastSwitchSummaryPath || null,
        pendingSwitchSummaryPath: workspace.context?.pendingSwitchSummaryPath || null,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.warn(`[Squire] Failed to sync workspace metadata for ${workspace.workspaceId}:`, error);
    }
  }

  private calculateNextRun(schedule: TaskSchedule): string {
    const now = new Date();
    try {
      return calculateNextRun(schedule, now).toISOString();
    } catch (error) {
      console.error('[Squire] Error calculating next run:', error);
      return new Date(now.getTime() + 60000).toISOString();
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
