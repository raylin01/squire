/**
 * Memory Module
 *
 * Hybrid memory system with:
 * - Core Memory: Long-term curated facts, preferences, decisions
 * - Daily Logs: Day-based work summaries and activity
 */

// Hybrid system (main entry point)
export { HybridMemoryManager, createHybridMemoryManager } from './hybrid-manager.js';
export type { HybridMemoryOptions, MemoryContext } from './hybrid-manager.js';

// Core memory (long-term)
export { CoreMemoryManager, createCoreMemoryManager } from './core-memory.js';
export type { CoreMemoryOptions } from './core-memory.js';

// Daily logs (day-based)
export { DailyLogManager, createDailyLogManager } from './daily-log.js';
export type { DailyLogOptions } from './daily-log.js';

// Types
export * from './types.js';
