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

  // Model configuration
  model: string;
  fallbackModel?: string;

  // Behavior
  daemonMode: boolean;
  pollInterval: number;

  // Memory
  memory: MemoryConfig;

  // Skills
  skills: SkillsConfig;

  // Permissions (simpler than DisCode)
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

export interface PermissionConfig {
  mode: 'trust' | 'confirm' | 'ask';
  allowedTools: string[];
  blockedTools: string[];
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
  projectPath?: string;
  currentTask?: string;
  recentFiles?: string[];
  environment?: Record<string, string>;
  guildId?: string;
  channelId?: string;
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

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type TaskScheduleType = 'once' | 'interval' | 'cron';

export interface TaskSchedule {
  type: TaskScheduleType;
  value: string | number;
}

export interface ScheduledTask {
  taskId: string;
  workspaceId: string;
  description: string;
  schedule: TaskSchedule;
  status: TaskStatus;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
  result?: TaskResult;
  runCount?: number;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  completedAt: string;
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
  | 'channel_operation';

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
  getTasks(workspaceId?: string): ScheduledTask[];
  cancelTask(taskId: string): Promise<void>;

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
  source?: MemorySource;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface ScheduleTaskOptions {
  workspaceId: string;
  description: string;
  schedule: TaskSchedule;
}
