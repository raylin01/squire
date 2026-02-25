/**
 * Squire Core Types
 *
 * All type definitions for the Squire personal AI assistant system.
 */

// ============================================================================
// Squire Configuration
// ============================================================================

export interface SquireConfig {
  // Identification
  squireId: string;
  name: string;

  // Storage paths
  dataDir: string;
  memoryDbPath: string;
  skillsDir: string;

  // SDK configuration
  sdk: SDKConfig;

  // Model configuration (optional override)
  model?: string;
  fallbackModel?: string;

  // Behavior
  daemonMode: boolean;
  pollInterval: number;

  // Memory
  memory: MemoryConfig;

  // Skills
  skills: SkillsConfig;

  // Tools
  tools: ToolsConfig;

  // Personality
  personality: PersonalityConfig;

  // Permissions
  permissions: PermissionConfig;
}

export interface MemoryConfig {
  enabled: boolean;
  provider: 'qmd' | 'openai' | 'voyage';
  qmdPath?: string;
  dataDir?: string;
  enableReranking?: boolean;
  embeddingModel?: string;
  retentionDays: number;
}

export interface SkillsConfig {
  bundled: string[];
  additional: string[];
  autoInstall: boolean;
}

export interface ToolsConfig {
  globalDir: string;     // ~/.squire/tools
  projectDir: string;    // ./.squire/tools
  autoInstall: boolean;
  searchEnabled: boolean;
}

// ============================================================================
// Personality System
// ============================================================================

export interface PersonalityTraits {
  tone: 'professional' | 'casual' | 'friendly' | 'formal';
  verbosity: 'concise' | 'balanced' | 'detailed';
  technicality: 'simple' | 'moderate' | 'expert';
  enthusiasm: 'reserved' | 'neutral' | 'enthusiastic';
  humor: 'none' | 'subtle' | 'moderate';
}

export interface Personality {
  name: string;
  description: string;
  traits: PersonalityTraits;
  customInstructions?: string;
}

export interface PersonalityConfig {
  default: Personality;
  workspaceOverrides: Record<string, Partial<Personality>>;
}

export interface PermissionConfig {
  mode: 'strict' | 'autoSafe' | 'permissive';
  allowedTools: string[];
  blockedTools: string[];
}

// SDK Configuration
export type SDKProvider = 'claude' | 'gemini' | 'codex';

export interface SDKConfig {
  provider: SDKProvider;
  model?: string;
  cliPath?: string;
  resumeSessionId?: string;
}

// ============================================================================
// Workspace
// ============================================================================

export type WorkspaceSource =
  | 'discord_channel'
  | 'discord_dm'
  | 'discord_forum'
  | 'discode_thread'
  | 'cli';

export type WorkspaceStatus = 'active' | 'idle' | 'paused';

export interface Workspace {
  workspaceId: string;
  name: string;
  source: WorkspaceSource;
  sourceId: string;
  createdAt: string;
  lastActivityAt: string;
  status: WorkspaceStatus;
  context: WorkspaceContext;
}

export interface WorkspaceContext {
  /** Sandbox directory - isolated folder for this workspace */
  sandboxPath?: string;
  /** Project directory - where the SDK runs (defaults to sandboxPath) */
  projectPath?: string;
  /** IANA timezone for workspace scheduling (e.g. "America/New_York") */
  timezone?: string;
  /** CLI session ID for resuming conversations (persists context across restarts) */
  cliSessionId?: string;
  currentTask?: string;
  recentFiles?: string[];
  environment?: Record<string, string>;
  guildId?: string;
  channelId?: string;
  personality?: Partial<Personality>;
  enabledTools?: string[];
}

// ============================================================================
// Memory
// ============================================================================

export type MemorySource = 'user' | 'squire' | 'skill' | 'document';

export interface MemoryEntry {
  id: string;
  content: string;
  source: MemorySource;
  workspaceId?: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

// ============================================================================
// Scheduled Tasks
// ============================================================================

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type TaskScheduleType = 'once' | 'interval' | 'cron';
export type ScheduledTaskKind = 'self';

export interface ScheduledTaskPayload {
  objective: string;
  context?: string;
  autoFixRequested?: boolean;
  lastFailureSummary?: string;
  metadata?: Record<string, unknown>;
}

export type TaskRunDecision = 'retry_now' | 'skip_run' | 'disable_task' | 'auto_fix_retry';

export interface TaskSchedule {
  type: TaskScheduleType;
  value: string | number;
}

export interface ScheduledTask {
  taskId: string;
  workspaceId: string;
  kind: ScheduledTaskKind;
  description: string;
  payload: ScheduledTaskPayload;
  timezone?: string;
  schedule: TaskSchedule;
  status: TaskStatus;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
  awaitingDecisionReason?: string;
  lastDecisionAt?: string;
  result?: TaskResult;
  runCount?: number;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  parsedSummary?: string;
  suggestedFixes?: string[];
  completedAt: string;
}

export interface ScheduledTaskRun {
  runId: string;
  taskId: string;
  startedAt: string;
  completedAt?: string;
  status: TaskStatus;
  outputExcerpt?: string;
  rawError?: string;
  parsedSummary?: string;
  decision?: TaskRunDecision;
}

// ============================================================================
// Skills
// ============================================================================

export interface SkillInstallStep {
  type: 'brew' | 'npm' | 'go' | 'uv' | 'download';
  package: string;
  version?: string;
}

export interface SkillMetadata {
  emoji?: string;
  requires?: {
    bins?: string[];
    env?: string[];
  };
  install?: SkillInstallStep[];
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  metadata?: {
    squire?: SkillMetadata;
  };
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  frontmatter: SkillFrontmatter;
  content: string;
  eligible: boolean;
  eligibilityReason?: string;
}

// ============================================================================
// External Tools (Plugin System)
// ============================================================================

export interface ToolMetadata {
  requires?: {
    bins?: string[];
    env?: string[];
  };
  keywords?: string[];
  repository?: string;
}

export interface ToolFrontmatter {
  name: string;
  description: string;
  version: string;
  author?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
  metadata?: {
    squire?: ToolMetadata;
  };
}

export interface SquireTool {
  name: string;
  description: string;
  path: string;
  source: 'global' | 'project' | 'bundled';
  frontmatter: ToolFrontmatter;
  eligible: boolean;
  eligibilityReason?: string;
}

export interface ToolHandlerContext {
  workspaceId?: string;
  squireId: string;
  config: SquireConfig;
  memory?: {
    remember: (content: string, metadata?: Record<string, unknown>) => Promise<void>;
    recall: (query: string, limit?: number) => Promise<MemorySearchResult[]>;
  };
  communication?: {
    sendText: (content: string) => Promise<void>;
    sendEmbed: (title: string, description: string, color?: string) => Promise<void>;
  };
}

// ============================================================================
// Messages
// ============================================================================

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError: boolean;
}

export interface SquireMessage {
  role: 'user' | 'assistant';
  content: string;
  workspaceId: string;
  timestamp: string;
  metadata?: {
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    memories?: string[];
  };
}

// ============================================================================
// Tickets (Phase 8)
// ============================================================================

export type TicketType = 'bug' | 'feature' | 'question' | 'task';

export type TicketStatus =
  | 'open'
  | 'triage'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'wontfix'
  | 'duplicate';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export type TicketAssignee = 'unassigned' | 'ai' | 'user';

export interface Ticket {
  ticketId: string;
  forumPostId?: string;
  forumChannelId?: string;
  guildId: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: TicketAssignee;
  assigneeUserId?: string;
  title: string;
  description: string;
  createdBy: 'user' | 'ai';
  createdById: string;
  createdAt: string;
  updatedAt: string;
  relatedSessionIds: string[];
  linkedCommitShas: string[];
  linkedPrUrls: string[];
  aiContext?: TicketAiContext;
}

export interface TicketAiContext {
  lastAnalysis?: string;
  suggestedApproach?: string;
  estimatedComplexity?: 'trivial' | 'simple' | 'moderate' | 'complex';
}

export interface TicketComment {
  commentId: string;
  ticketId: string;
  discordMessageId?: string;
  author: 'user' | 'ai';
  authorId: string;
  content: string;
  createdAt: string;
  isAiQuestion?: boolean;
  isStatusUpdate?: boolean;
}

// ============================================================================
// Channel Tools (for SquireBot communication)
// ============================================================================

export interface ChannelOperation {
  type: 'create_channel' | 'send_message' | 'rename_channel' | 'set_topic' | 'create_forum_post';
  requestId: string;
  data: Record<string, unknown>;
}

export interface ChannelOperationResult {
  requestId: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Events
// ============================================================================

export type SquireEventType =
  | 'squire_started'
  | 'squire_stopped'
  | 'workspace_created'
  | 'workspace_activated'
  | 'workspace_updated'
  | 'output'
  | 'thinking'
  | 'tool_use'
  | 'complete'
  | 'memory_added'
  | 'memory_searched'
  | 'task_scheduled'
  | 'task_completed'
  | 'task_failed'
  | 'skill_loaded'
  | 'message_received'
  | 'message_sent'
  | 'ticket_created'
  | 'ticket_updated'
  | 'ticket_assigned'
  | 'channel_operation'
  | 'communication'
  | 'approval_required'
  | 'status';

export interface SquireEvent {
  type: SquireEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type SquireEventHandler = (event: SquireEvent) => void;

// ============================================================================
// Squire Instance Interface
// ============================================================================

export interface SquireInterface {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;

  // Workspace Management
  createWorkspace(options: CreateWorkspaceOptions): Promise<Workspace>;
  getWorkspace(workspaceId: string): Workspace | undefined;
  getWorkspaceBySource(source: WorkspaceSource, sourceId: string): Workspace | undefined;
  getWorkspaces(): Workspace[];
  setActiveWorkspace(workspaceId: string): void;
  getActiveWorkspace(): Workspace | undefined;

  // Memory
  remember(content: string, options?: RememberOptions): Promise<MemoryEntry>;
  recall(query: string, limit?: number): Promise<MemorySearchResult[]>;

  // Messaging
  sendMessage(workspaceId: string, content: string): Promise<SquireMessage>;

  // Scheduling
  scheduleTask(options: ScheduleTaskOptions): Promise<ScheduledTask>;
  getTask(taskId: string): ScheduledTask | null;
  getTasks(workspaceId?: string): ScheduledTask[];
  cancelTask(taskId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  retryTask(taskId: string, options?: { autoFix?: boolean }): Promise<void>;
  skipTaskRun(taskId: string): Promise<void>;

  // Skills
  getSkills(): Skill[];
  loadSkill(path: string): Promise<Skill>;

  // Events
  on(event: SquireEventType, handler: SquireEventHandler): void;
  off(event: SquireEventType, handler: SquireEventHandler): void;
  emit(event: SquireEvent): void;
}

export interface CreateWorkspaceOptions {
  name: string;
  source: WorkspaceSource;
  sourceId: string;
  context?: WorkspaceContext;
}

export interface RememberOptions {
  type?: string;              // Memory type: preference, fact, decision, pattern, skill, project
  source?: MemorySource;
  workspaceId?: string;
  tags?: string[];
  confidence?: number;        // 0-1, how confident
  evidence?: string;          // Why we believe this
}

export interface ScheduleTaskOptions {
  workspaceId: string;
  description: string;
  payload?: ScheduledTaskPayload;
  timezone?: string;
  schedule: TaskSchedule;
}
