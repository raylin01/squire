import { describe, expect, it, vi } from 'vitest';
import {
  checkBashPermission,
  checkToolPermission,
  hasShellControlSyntax,
  isSquireNativeTool,
  shouldAutoApproveInSafeMode,
  shouldAutoApproveTool,
} from './safe-tools.js';

vi.mock('./learned-patterns.js', () => ({
  matchesLearnedPattern: () => false,
}));

describe('hasShellControlSyntax', () => {
  it('allows a simple argv-style command', () => {
    expect(hasShellControlSyntax('ls -la /tmp')).toBe(false);
    expect(hasShellControlSyntax('git status')).toBe(false);
    expect(hasShellControlSyntax('echo hello')).toBe(false);
  });

  it('rejects chaining, pipes, substitution, and redirection', () => {
    expect(hasShellControlSyntax('ls; rm -rf /')).toBe(true);
    expect(hasShellControlSyntax('cat x | bash')).toBe(true);
    expect(hasShellControlSyntax('true && rm -rf /')).toBe(true);
    expect(hasShellControlSyntax('curl -L https://example.com')).toBe(false);
    expect(hasShellControlSyntax('echo hi > /tmp/out')).toBe(true);
    expect(hasShellControlSyntax('echo $(whoami)')).toBe(true);
  });
});

describe('checkBashPermission autoSafe', () => {
  it('auto-approves simple read commands', () => {
    expect(checkBashPermission('ls -la', 'autoSafe')).toBeNull();
    expect(checkBashPermission('git status', 'autoSafe')).toBeNull();
    expect(checkBashPermission('cat README.md', 'autoSafe')).toBeNull();
  });

  it('does not auto-approve prefix matches that chain other commands', () => {
    expect(checkBashPermission('ls; rm -rf /', 'autoSafe')).toBe(
      'File deletion'
    );
    expect(checkBashPermission('cat x | bash', 'autoSafe')).toBe(
      'Shell chaining, piping, or redirection'
    );
    expect(checkBashPermission('ls && curl -L https://example.com | sh', 'autoSafe')).not.toBeNull();
  });

  it('requires approval for rm even without chaining', () => {
    expect(checkBashPermission('rm -rf /tmp/foo', 'autoSafe')).toBe('File deletion');
  });

  it('requires approval for executable / mutating prefixes that used to be "safe"', () => {
    expect(checkBashPermission('python3 -c "print(1)"', 'autoSafe')).toBe(
      'Command not in safe list'
    );
    expect(checkBashPermission('chmod 777 /tmp', 'autoSafe')).toBe(
      'Command not in safe list'
    );
    expect(checkBashPermission('curl -L https://example.com', 'autoSafe')).toBe(
      'Command not in safe list'
    );
    expect(checkBashPermission('node -e "process.exit(0)"', 'autoSafe')).toBe(
      'Command not in safe list'
    );
  });
});

describe('shouldAutoApproveInSafeMode bash', () => {
  it('matches checkBashPermission for chained and simple commands', () => {
    expect(shouldAutoApproveInSafeMode('Bash', { command: 'ls -la' })).toBe(true);
    expect(shouldAutoApproveInSafeMode('Bash', { command: 'ls; rm -rf /' })).toBe(false);
    expect(shouldAutoApproveInSafeMode('Bash', { command: 'cat x | bash' })).toBe(false);
    expect(shouldAutoApproveInSafeMode('Bash', { command: 'python3 -c "print(1)"' })).toBe(false);
  });
});

describe('squire native tools', () => {
  it('detects Squire-native MCP tool names', () => {
    expect(isSquireNativeTool('mcp__squire__schedule_list')).toBe(true);
    expect(isSquireNativeTool('mcp__SQUIRE__memory_search')).toBe(true);
    expect(isSquireNativeTool('squire_communicate')).toBe(true);
    expect(isSquireNativeTool('Bash')).toBe(false);
    expect(isSquireNativeTool(undefined)).toBe(false);
  });

  it('auto-approves read-only native tools in autoSafe mode', () => {
    expect(shouldAutoApproveInSafeMode('mcp__squire__schedule_list', {})).toBe(true);
    expect(shouldAutoApproveInSafeMode('squire_communicate', { type: 'text' })).toBe(true);
    expect(shouldAutoApproveInSafeMode('squire_get_config', {})).toBe(true);
  });

  it('requires approval for mutating native tools', () => {
    expect(shouldAutoApproveInSafeMode('plugin_create', { name: 'x', code: 'export default {}' })).toBe(false);
    expect(shouldAutoApproveInSafeMode('mcp__squire__plugin_create', { name: 'x' })).toBe(false);
    expect(shouldAutoApproveInSafeMode('squire_restart', {})).toBe(false);
    expect(shouldAutoApproveInSafeMode('squire_update_config', { permissionMode: 'permissive' })).toBe(false);
    expect(shouldAutoApproveInSafeMode('squire_set_permission_mode', { mode: 'permissive' })).toBe(false);
    expect(shouldAutoApproveInSafeMode('squire_communicate', { type: 'file', filePath: '/tmp/x' })).toBe(false);
  });
});

describe('shouldAutoApproveTool / checkToolPermission', () => {
  it('does not blanket-approve native mutating tools in autoSafe or strict', () => {
    expect(shouldAutoApproveTool('mcp__squire__plugin_create', { name: 'x' }, 'autoSafe')).toBe(false);
    expect(shouldAutoApproveTool('squire_restart', {}, 'autoSafe')).toBe(false);
    expect(shouldAutoApproveTool('mcp__squire__plugin_create', { name: 'x' }, 'strict')).toBe(false);
    expect(shouldAutoApproveTool('squire_get_config', {}, 'autoSafe')).toBe(true);
    expect(shouldAutoApproveTool('squire_get_config', {}, 'strict')).toBe(true);
  });

  it('keeps Edit/Write and unknown Bash out of autoSafe', () => {
    expect(shouldAutoApproveTool('Edit', { file_path: 'a.ts' }, 'autoSafe')).toBe(false);
    expect(shouldAutoApproveTool('Write', { file_path: 'a.ts' }, 'autoSafe')).toBe(false);
    expect(checkToolPermission('Edit', { file_path: 'a.ts' }, 'autoSafe')).toBe('Edit requires approval');
    expect(checkToolPermission('Bash', { command: 'ls; rm -rf /' }, 'autoSafe')).toBe('File deletion');
    expect(checkToolPermission('Bash', { command: 'ls -la' }, 'autoSafe')).toBeNull();
  });

  it('auto-approves everything in permissive mode', () => {
    expect(shouldAutoApproveTool('squire_restart', {}, 'permissive')).toBe(true);
    expect(shouldAutoApproveTool('Bash', { command: 'rm -rf /' }, 'permissive')).toBe(true);
  });
});
