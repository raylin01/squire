/**
 * Learned Safe Patterns
 *
 * Records user-approved commands and auto-approves similar commands in the future.
 * Patterns persist across restarts in ~/.squire/learned-patterns.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface LearnedPattern {
  /** Base pattern extracted from command (e.g., "git push") */
  base: string;
  /** Full commands that were approved (for reference) */
  examples: string[];
  /** How many times this pattern has been approved */
  approvalCount: number;
  /** ISO timestamp of last approval */
  lastApproved: string;
}

interface LearnedPatternsFile {
  version: number;
  patterns: LearnedPattern[];
}

// ============================================================================
// Storage
// ============================================================================

let patterns: LearnedPattern[] = [];
let patternsPath: string | null = null;
let isLoaded = false;

/**
 * Get the path to the learned patterns file
 */
function getPatternsPath(): string {
  if (!patternsPath) {
    const squireDir = path.join(os.homedir(), '.squire');
    // Ensure directory exists
    if (!fs.existsSync(squireDir)) {
      fs.mkdirSync(squireDir, { recursive: true });
    }
    patternsPath = path.join(squireDir, 'learned-patterns.json');
  }
  return patternsPath;
}

/**
 * Load patterns from disk
 */
export function loadLearnedPatterns(): void {
  if (isLoaded) return;

  try {
    const filePath = getPatternsPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const file: LearnedPatternsFile = JSON.parse(data);
      patterns = file.patterns || [];
      console.log(`[LearnedPatterns] Loaded ${patterns.length} patterns`);
    }
  } catch (error) {
    console.warn('[LearnedPatterns] Failed to load patterns:', error);
    patterns = [];
  }
  isLoaded = true;
}

/**
 * Save patterns to disk
 */
function saveLearnedPatterns(): void {
  try {
    const filePath = getPatternsPath();
    const file: LearnedPatternsFile = {
      version: 1,
      patterns,
    };
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2));
  } catch (error) {
    console.warn('[LearnedPatterns] Failed to save patterns:', error);
  }
}

// ============================================================================
// Pattern Extraction
// ============================================================================

/**
 * Commands that should keep 2 words for the base pattern
 * (command + subcommand)
 */
const TWO_WORD_COMMANDS = new Set([
  'git', 'docker', 'npm', 'yarn', 'pnpm', 'bun',
  'kubectl', 'aws', 'gcloud', 'az',
  'cargo', 'rustup', 'go',
]);

/**
 * Extract a base pattern from a full command.
 *
 * Examples:
 * - "git push origin main" -> "git push"
 * - "npm run build" -> "npm run build"
 * - "python3 script.py" -> "python3"
 * - "/path/to/script.sh" -> "/path/to/script.sh"
 */
export function extractBasePattern(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';

  // Split into words, handling quoted strings loosely
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return '';

  const firstWord = parts[0];

  // Check if this is a two-word command
  if (TWO_WORD_COMMANDS.has(firstWord) && parts.length > 1) {
    // Keep first two words for commands like "git push", "npm run"
    return `${firstWord} ${parts[1]}`;
  }

  // For everything else, just keep the first word
  return firstWord;
}

/**
 * Check if a command matches a learned pattern
 */
export function matchesLearnedPattern(command: string): boolean {
  loadLearnedPatterns();

  const basePattern = extractBasePattern(command);
  if (!basePattern) return false;

  return patterns.some(p => p.base === basePattern);
}

/**
 * Get the learned pattern for a command (if any)
 */
export function getLearnedPattern(command: string): LearnedPattern | undefined {
  loadLearnedPatterns();

  const basePattern = extractBasePattern(command);
  return patterns.find(p => p.base === basePattern);
}

// ============================================================================
// Pattern Management
// ============================================================================

/**
 * Add or update a learned pattern from an approved command
 */
export function addLearnedPattern(command: string): void {
  loadLearnedPatterns();

  const basePattern = extractBasePattern(command);
  if (!basePattern) return;

  const existing = patterns.find(p => p.base === basePattern);

  if (existing) {
    // Update existing pattern
    existing.approvalCount++;
    existing.lastApproved = new Date().toISOString();

    // Add example if not already present (keep max 5 examples)
    if (!existing.examples.includes(command)) {
      existing.examples.push(command);
      if (existing.examples.length > 5) {
        existing.examples.shift(); // Remove oldest
      }
    }
  } else {
    // Create new pattern
    patterns.push({
      base: basePattern,
      examples: [command],
      approvalCount: 1,
      lastApproved: new Date().toISOString(),
    });
  }

  saveLearnedPatterns();
  console.log(`[LearnedPatterns] Recorded pattern: ${basePattern}`);
}

/**
 * Remove a learned pattern by base
 */
export function removeLearnedPattern(base: string): boolean {
  loadLearnedPatterns();

  const index = patterns.findIndex(p => p.base === base);
  if (index === -1) return false;

  patterns.splice(index, 1);
  saveLearnedPatterns();
  return true;
}

/**
 * Clear all learned patterns
 */
export function clearLearnedPatterns(): void {
  patterns = [];
  saveLearnedPatterns();
  console.log('[LearnedPatterns] Cleared all patterns');
}

/**
 * Get all learned patterns (for display)
 */
export function getAllLearnedPatterns(): LearnedPattern[] {
  loadLearnedPatterns();
  return [...patterns];
}

/**
 * Get statistics about learned patterns
 */
export function getLearnedPatternsStats(): { count: number; totalApprovals: number } {
  loadLearnedPatterns();
  return {
    count: patterns.length,
    totalApprovals: patterns.reduce((sum, p) => sum + p.approvalCount, 0),
  };
}
