/**
 * Squire Tool Registry
 *
 * Re-exports from registry.ts and imports all tool modules to register them.
 */

// Import and re-export from registry (no circular deps)
export { toolRegistry, defineTool, setExecutionContext, getExecutionContext, clearExecutionContext } from './registry.js';
export type { ToolHandler, RegisteredTool, ToolExecutionContext } from './registry.js';

// Re-export setSquireInstance from self-modify (after registry import to avoid circular)
export { setSquireInstance } from './self-modify.js';

// Import all tools to register them (these import from registry.js, not here)
import './communicate.js';
import './self-manage.js';
import './self-modify.js';
import './memory.js';
import './scheduler.js';
import './tickets.js';
import './plugins.js';

// Re-export tool modules
export * from './communicate.js';
export * from './self-manage.js';
export * from './self-modify.js';
export * from './memory.js';
export * from './scheduler.js';
export * from './tickets.js';
export * from './plugins.js';
export * from './loader.js';
export * from './frontmatter.js';
