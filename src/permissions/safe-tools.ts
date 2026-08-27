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
  // Package managers (install / inspect only; postinstall scripts still exist,
  // but these are not prefix-matches of arbitrary chained commands)
  /^npm\s+(install|i|add|update|run|test|build|dev)$/,
  /^npm\s+install\s+/,
  /^npm\s+run\s+/,
  /^npm\s+test/,
  /^pip\s+install/,
  /^pip3?\s+install/,
  /^pip3?\s+show/,
  /^pip3?\s+list/,
  /^bun\s+(install|add|run|test|build|dev)\b/,

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

  // Git read / fetch operations (not push, reset, or clean)
  /^git\s+status/,
  /^git\s+log/,
  /^git\s+diff/,
  /^git\s+show/,
  /^git\s+branch/,
  /^git\s+remote/,
  /^git\s+fetch/,

  // Development inspect
  /^cargo\s+(test|check|clippy)\b/,
  /^go\s+(test|fmt|vet)\b/,

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

  // Destructive file ops (not autoSafe)
  { pattern: /\brm(\s|$)/, reason: 'File deletion' },
  { pattern: /\brmdir\s/, reason: 'Directory deletion' },

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

/**
 * True when a command uses shell chaining, piping, substitution, or redirection.
 * SAFE_PATTERNS are prefix regexes; without this guard, `ls; rm -rf /` matches `^ls\b`.
 */
const SHELL_CONTROL_SYNTAX = /(?:\n|;|\|\||&&|\||`|\$\(|\$\{|[<>]|(?:^|[^&])&(?:[^&]|$))/;

export function hasShellControlSyntax(command: string): boolean {
  return SHELL_CONTROL_SYNTAX.test(command);
}

/**
 * Native Squire/MCP tools that must never be auto-approved in autoSafe.
 * Prefix-matching every `squire_*` / `mcp__squire__*` would auto-approve
 * plugin writes that the bot later import()s, restarts, and config mutation.
 */
const NATIVE_TOOLS_REQUIRING_APPROVAL = new Set([
  'plugin_create',
  'plugin_update',
  'squire_restart',
  'squire_update_config',
  'squire_set_permission_mode',
  'squire_switch_sdk',
  'squire_switch_model',
]);

export function nativeToolBaseName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.startsWith('mcp__squire__')) {
    return normalized.slice('mcp__squire__'.length);
  }
  return normalized;
}

function bashApprovalReason(command: string, mode: PermissionMode): string | null {
  for (const { pattern, reason } of ALWAYS_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }

  if (hasShellControlSyntax(command)) {
    return 'Shell chaining, piping, or redirection';
  }

  if (mode === 'strict') {
    for (const { pattern, reason } of STRICT_ONLY_DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return reason;
      }
    }
  }

  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(command)) {
      return null;
    }
  }

  if (matchesLearnedPattern(command)) {
    return null;
  }

  return 'Command not in safe list';
}

/**
 * Check if a bash command requires approval.
 * Returns null if auto-approved, or the reason if approval is needed.
 */
export function checkBashPermission(
  command: string,
  mode: PermissionMode
): string | null {
  if (mode === 'permissive') {
    return null;
  }

  return bashApprovalReason(command, mode);
}

/**
 * Check if a tool use requires approval.
 * Returns null if auto-approved, or the reason if approval is needed.
 */
export function checkToolPermission(
  toolName: string,
  input: Record<string, unknown> | undefined,
  mode: PermissionMode
): string | null {
  if (shouldAutoApproveTool(toolName, input, mode)) {
    return null;
  }

  if (toolName === 'Bash') {
    return checkBashPermission(String(input?.command ?? ''), mode);
  }

  return `${toolName} requires approval`;
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
    return shouldAutoApproveNativeTool(toolName, input);
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
    return bashApprovalReason(command, 'autoSafe') === null;
  }

  // All other tools require approval
  return false;
}

/**
 * Single approval decision used by the Claude SDK and checkToolPermission.
 * Native Squire tools are not a blanket auto-approve in any mode.
 */
export function shouldAutoApproveTool(
  toolName: string,
  input: Record<string, unknown> | undefined,
  mode: PermissionMode
): boolean {
  if (mode === 'permissive') {
    return true;
  }

  if (mode === 'strict') {
    if (SAFE_TOOLS.has(toolName)) {
      return true;
    }
    if (isSquireNativeTool(toolName)) {
      return shouldAutoApproveNativeTool(toolName, input);
    }
    return false;
  }

  return shouldAutoApproveInSafeMode(toolName, input);
}

function shouldAutoApproveNativeTool(
  toolName: string,
  input: Record<string, unknown> | undefined
): boolean {
  const base = nativeToolBaseName(toolName);
  if (NATIVE_TOOLS_REQUIRING_APPROVAL.has(base)) {
    return false;
  }

  if (base === 'squire_communicate') {
    const type = input?.type;
    if (type === 'file' || Boolean(input?.filePath)) {
      return false;
    }
  }

  return true;
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
