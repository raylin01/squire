/**
 * Squire Permission System
 *
 * Minimal permission system for Squire - only the most dangerous operations
 * require approval. Squire is designed to be autonomous and trusted.
 *
 * Permission modes:
 * - strict: All dangerous operations require approval
 * - autoSafe: Only destructive operations require approval (default)
 * - permissive: No approval required (dangerous mode)
 */

import { matchesLearnedPattern } from './learned-patterns.js';

// ============================================================================
// Safe Patterns - Always auto-approved
// ============================================================================

/**
 * Commands that are always safe and auto-approved.
 * These patterns are checked first - if matched, no approval needed.
 */
const SAFE_PATTERNS: Array<RegExp> = [
  // Python execution (inline scripts)
  /^python3?\s+-c\s+/,
  /^python3?\s+-m\s+/,
  /^python3?\s+[\w\/.-]+\.py$/,

  // Package managers (install only, not remove)
  /^npm\s+(install|i|add|update|run|test|build|dev)$/,
  /^npm\s+install\s+/,
  /^npm\s+run\s+/,
  /^npm\s+test/,
  /^pip\s+install/,
  /^pip3?\s+install/,
  /^pip3?\s+show/,
  /^pip3?\s+list/,
  /^bun\s+(install|add|run|test|build|dev)/,

  // File reading/viewing
  /^cat\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^less\s+/,
  /^more\s+/,
  /^wc\s+/,
  /^file\s+/,
  /^ls\b/,
  /^find\s+/,
  /^grep\s+/,
  /^rg\s+/,
  /^ag\s+/,

  // Git safe operations
  /^git\s+status/,
  /^git\s+log/,
  /^git\s+diff/,
  /^git\s+show/,
  /^git\s+branch/,
  /^git\s+remote/,
  /^git\s+fetch/,
  /^git\s+pull(?!\s+--rebase)/,
  /^git\s+clone/,

  // Node/bun execution
  /^node\s+/,
  /^bun\s+/,
  /^npx\s+/,
  /^tsx\s+/,
  /^ts-node\s+/,

  // Development tools
  /^make\s+/,
  /^cargo\s+(build|run|test|check|clippy)/,
  /^go\s+(build|run|test|fmt|vet)/,
  /^rustc\s+/,

  // System info
  /^which\s+/,
  /^whereis\s+/,
  /^type\s+/,
  /^echo\s+/,
  /^printf\s+/,
  /^env\b/,
  /^printenv/,
  /^uname/,
  /^sw_vers/,
  /^date\b/,
  /^uptime/,

  // Safe curl (info only)
  /^curl\s+-I\s+/,
  /^curl\s+-s\s+/,
  /^curl\s+-L\s+/,

  // Misc safe commands
  /^mkdir\s+/,
  /^touch\s+/,
  /^cp\s+/,
  /^mv\s+/,
  /^chmod\s+/,
  /^ln\s+-s/,
];

// ============================================================================
// Truly Dangerous Operations - ALWAYS require approval
// ============================================================================

/**
 * Operations that are ALWAYS dangerous and require approval,
 * even in autoSafe mode.
 */
const ALWAYS_DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // System control
  { pattern: /\bshutdown\b/, reason: 'System shutdown' },
  { pattern: /\breboot\b/, reason: 'System reboot' },
  { pattern: /\bpoweroff\b/, reason: 'System power off' },
  { pattern: /\bhalt\b/, reason: 'System halt' },

  // Privilege escalation
  { pattern: /\bsudo\s/, reason: 'Privilege escalation' },
  { pattern: /\bsu\s/, reason: 'User switching' },

  // Disk operations
  { pattern: /\bdd\s+if=/, reason: 'Disk operations with dd' },
  { pattern: /\bmkfs\b/, reason: 'Filesystem creation' },
  { pattern: /\bfdisk\b/, reason: 'Disk partitioning' },

  // Fork bomb
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};\s*:/, reason: 'Fork bomb' },

  // Download and execute
  { pattern: /\bcurl\s+.*\|\s*(bash|sh|zsh|fish)/, reason: 'Download and execute' },
  { pattern: /\bwget\s+.*\|\s*(bash|sh|zsh|fish)/, reason: 'Download and execute' },
];

/**
 * Operations that are dangerous in strict mode but auto-approved in autoSafe mode.
 * These can modify files/system but are generally recoverable.
 */
const STRICT_ONLY_DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // File deletion
  { pattern: /\brm\s/, reason: 'File deletion' },
  { pattern: /\brmdir\s/, reason: 'Directory deletion' },

  // Git dangerous
  { pattern: /\bgit\s+push\s+.*--force\b/, reason: 'Force push' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'Hard reset' },
  { pattern: /\bgit\s+clean\s+-[fdx]/, reason: 'Clean untracked files' },

  // Process control
  { pattern: /\bkill\s+-9\b/, reason: 'Force kill' },
  { pattern: /\bpkill\s/, reason: 'Process termination' },

  // Docker dangerous
  { pattern: /\bdocker\s+system\s+prune\b/, reason: 'Docker cleanup' },
  { pattern: /\bdocker\s+rm\s/, reason: 'Container removal' },
  { pattern: /\bdocker\s+rmi\s/, reason: 'Image removal' },

  // Kubernetes
  { pattern: /\bkubectl\s+delete\b/, reason: 'Kubernetes deletion' },
];

// ============================================================================
// Permission Mode Types
// ============================================================================

export type PermissionMode = 'strict' | 'autoSafe' | 'permissive';

// ============================================================================
// Permission Checking Functions
// ============================================================================

/**
 * Check if a bash command requires approval.
 * Returns null if auto-approved, or the reason if approval is needed.
 */
export function checkBashPermission(
  command: string,
  mode: PermissionMode
): string | null {
  // Permissive mode - approve everything
  if (mode === 'permissive') {
    return null;
  }

  // Check always dangerous patterns FIRST (take precedence over safe patterns)
  for (const { pattern, reason } of ALWAYS_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }

  // In strict mode, also check strict-only dangerous patterns
  if (mode === 'strict') {
    for (const { pattern, reason } of STRICT_ONLY_DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return reason;
      }
    }
  }

  // Check safe patterns - auto-approve if matched
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(command)) {
      return null;  // Auto-approve safe commands
    }
  }

  // Check learned patterns - auto-approve if user has approved before
  if (matchesLearnedPattern(command)) {
    return null;  // Auto-approve learned commands
  }

  // Default: require approval for unknown commands (secure by default)
  return 'Command not in safe list';
}

/**
 * Check if a tool use requires approval.
 * Returns null if auto-approved, or the reason if approval is needed.
 */
export function checkToolPermission(
  toolName: string,
  _input: Record<string, unknown>,
  mode: PermissionMode
): string | null {
  // Permissive mode - approve everything
  if (mode === 'permissive') {
    return null;
  }

  // Tools that ALWAYS require approval (even in autoSafe)
  const alwaysRequireApproval = new Set([
    'shutdown',
    'reboot',
    'system_control',
  ]);

  if (alwaysRequireApproval.has(toolName)) {
    return `${toolName} requires approval`;
  }

  // In strict mode, file modifications require approval
  if (mode === 'strict') {
    const strictRequireApproval = new Set([
      'Edit',
      'Write',
      'Bash',
      'Task',
    ]);

    if (strictRequireApproval.has(toolName)) {
      return `${toolName} requires approval in strict mode`;
    }
  }

  // Auto-approve
  return null;
}

/**
 * Check if a bash command is considered dangerous.
 * Used for logging/transparency purposes.
 */
export function isDangerousCommand(command: string): boolean {
  for (const { pattern } of ALWAYS_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return true;
    }
  }
  for (const { pattern } of STRICT_ONLY_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return true;
    }
  }
  return false;
}

/**
 * Get the reason why a command is dangerous.
 */
export function getDangerousReason(command: string): string | null {
  for (const { pattern, reason } of ALWAYS_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  for (const { pattern, reason } of STRICT_ONLY_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return null;
}

// ============================================================================
// SDK Integration Functions
// ============================================================================

/**
 * Tools that are always safe to auto-approve (read-only operations).
 */
export const SAFE_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LSP',
  'DirectoryTree',
  'NotebookRead',
]);

/**
 * Tools that are always dangerous and require approval.
 */
export const DANGEROUS_TOOLS = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'Task',
  'Skill',
  'MCP',
  'ExitPlanMode',
]);

/**
 * Check if a tool with given input should be auto-approved in autoSafe mode.
 * This is the key function for SDK permission handling.
 *
 * @param toolName The name of the tool
 * @param input The tool input (for Bash, contains the command)
 * @returns true if the tool should be auto-approved
 */
export function shouldAutoApproveInSafeMode(
  toolName: string,
  input: Record<string, unknown> | undefined
): boolean {
  if (isSquireNativeTool(toolName)) {
    return true;
  }

  // AskUserQuestion should NEVER be auto-approved - it requires actual user input
  if (toolName === 'AskUserQuestion') {
    return false;
  }

  // Safe tools (read-only) are always auto-approved
  if (SAFE_TOOLS.has(toolName)) {
    return true;
  }

  // For Bash, check the command against our patterns
  if (toolName === 'Bash') {
    const command = (input?.command as string) || '';

    // First check for dangerous patterns - these take precedence
    for (const { pattern } of ALWAYS_DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return false;
      }
    }
    for (const { pattern } of STRICT_ONLY_DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return false;
      }
    }

    // Check for safe patterns
    for (const pattern of SAFE_PATTERNS) {
      if (pattern.test(command)) {
        return true;
      }
    }

    // Check learned patterns - auto-approve if user has approved before
    if (matchesLearnedPattern(command)) {
      return true;
    }

    // Default to requiring approval for unknown Bash commands
    return false;
  }

  // All other tools require approval
  return false;
}

/**
 * Returns true when a tool name maps to Squire-owned native tools (typically via MCP).
 */
export function isSquireNativeTool(toolName: string | undefined): boolean {
  if (!toolName || typeof toolName !== 'string') {
    return false;
  }

  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.startsWith('mcp__squire__') || normalized.startsWith('squire_');
}
