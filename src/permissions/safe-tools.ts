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

  // Check always dangerous patterns
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

  // Auto-approve
  return null;
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
