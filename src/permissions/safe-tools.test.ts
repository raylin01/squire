import { describe, expect, it } from 'vitest';
import { isSquireNativeTool, shouldAutoApproveInSafeMode } from './safe-tools.js';

describe('safe-tools', () => {
  it('detects Squire-native MCP tool names', () => {
    expect(isSquireNativeTool('mcp__squire__schedule_list')).toBe(true);
    expect(isSquireNativeTool('mcp__SQUIRE__memory_search')).toBe(true);
    expect(isSquireNativeTool('squire_communicate')).toBe(true);
    expect(isSquireNativeTool('Bash')).toBe(false);
    expect(isSquireNativeTool(undefined)).toBe(false);
  });

  it('auto-approves Squire-native tools in autoSafe mode', () => {
    expect(shouldAutoApproveInSafeMode('mcp__squire__schedule_list', {})).toBe(true);
    expect(shouldAutoApproveInSafeMode('squire_communicate', { type: 'text' })).toBe(true);
  });
});
