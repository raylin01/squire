/**
 * Memory Module
 *
 * Hybrid memory system with:
 * - Core Memory: Long-term curated facts, preferences, decisions
 * - Daily Logs: Day-based work summaries and activity
 * - QMD: Semantic search across all memory
 */

// New hybrid system
export { HybridMemoryManager, createHybridMemoryManager } from './hybrid-manager.js';
export type { HybridMemoryOptions } from './hybrid-manager.js';

// Core memory (long-term)
export { CoreMemoryManager, createCoreMemoryManager } from './core-memory.js';
export type { CoreMemoryOptions } from './core-memory.js';

// Daily logs (day-based)
export { DailyLogManager, createDailyLogManager } from './daily-log.js';
export type { DailyLogOptions } from './daily-log.js';

// Legacy QMD-based manager (for backward compatibility)
export { MemoryManager, createMemoryManager } from './manager.js';
export type { MemoryAddOptions, MemorySearchOptions } from './manager.js';

// Types
export * from './types.js';
