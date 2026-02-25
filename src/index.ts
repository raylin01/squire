/**
 * @squire/core
 *
 * Personal AI assistant with memory, skills, and scheduling.
 */

// Main class
export { Squire, createSquire } from './squire.js';

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
  getToolsDir,
  getDefaultPersonality,
} from './config.js';

// Personality
export {
  PersonalityManager,
  createPersonalityManager,
  PERSONALITY_TEMPLATES,
  getPersonalityTemplate,
  getPersonalityTemplateList,
  TRAIT_DESCRIPTIONS,
  getTraitDescription,
} from './personality/index.js';
export type { PersonalityTemplateName } from './personality/templates.js';

// Tools
export { toolRegistry, defineTool, setSquireInstance } from './tools/index.js';
export { createToolLoader } from './tools/loader.js';

// Types
export type {
  // Configuration
  SquireConfig,
  MemoryConfig,
  SkillsConfig,
  ToolsConfig,
  PermissionConfig,
  PersonalityConfig,
  Personality,
  PersonalityTraits,

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
  ScheduledTaskKind,
  ScheduledTaskPayload,
  ScheduledTaskRun,
  TaskSchedule,
  TaskScheduleType,
  TaskStatus,
  TaskResult,
  TaskRunDecision,

  // Skills
  Skill,
  SkillFrontmatter,
  SkillMetadata,
  SkillInstallStep,

  // Tools
  ToolFrontmatter,
  ToolMetadata,
  SquireTool,
  ToolHandlerContext,

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
