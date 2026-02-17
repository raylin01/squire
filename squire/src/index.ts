/**
 * @squire/core
 *
 * Personal AI assistant with memory, skills, and scheduling.
 */

// Main class
export { Squire } from './squire.js';

// Configuration
export {
  loadConfig,
  saveConfig,
  resolveConfig,
  createDefaultConfig,
  initConfig,
  validateConfig,
  mergeEnvConfig,
  ensureSquireDir,
  getSquireDir,
  getDataDir,
  getConfigPath,
} from './config.js';

// Types
export type {
  // Configuration
  SquireConfig,
  MemoryConfig,
  SkillsConfig,
  PermissionConfig,

  // Workspace
  Workspace,
  WorkspaceContext,
  WorkspaceSource,
  WorkspaceStatus,

  // Memory
  MemoryEntry,
  MemorySearchResult,
  MemorySource,

  // Scheduling
  ScheduledTask,
  TaskSchedule,
  TaskScheduleType,
  TaskStatus,
  TaskResult,

  // Skills
  Skill,
  SkillFrontmatter,
  SkillMetadata,
  SkillInstallStep,

  // Messages
  SquireMessage,
  ToolCall,
  ToolResult,

  // Tickets
  Ticket,
  TicketAiContext,
  TicketComment,
  TicketType,
  TicketStatus,
  TicketPriority,
  TicketAssignee,

  // Channel Operations
  ChannelOperation,
  ChannelOperationResult,

  // Events
  SquireEvent,
  SquireEventHandler,
  SquireEventType,

  // Interface
  SquireInterface,
  CreateWorkspaceOptions,
  RememberOptions,
  ScheduleTaskOptions,
} from './types.js';
