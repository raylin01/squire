import { describe, expect, it } from 'vitest';
import { shouldEnablePlugin } from './loader.js';

describe('shouldEnablePlugin', () => {
  it('skips plugins on the disabled list', () => {
    expect(shouldEnablePlugin('forum', { disabled: ['forum'], autoEnable: true })).toEqual({
      load: false,
      reason: 'Disabled in config',
    });
  });

  it('honors an explicit enabled allowlist', () => {
    expect(shouldEnablePlugin('other', { enabled: ['forum'], autoEnable: true })).toEqual({
      load: false,
      reason: 'Not in enabled list',
    });
    expect(shouldEnablePlugin('forum', { enabled: ['forum'], autoEnable: true }).load).toBe(true);
  });

  it('does not auto-load when autoEnable is false', () => {
    expect(shouldEnablePlugin('forum', { autoEnable: false })).toEqual({
      load: false,
      reason: 'autoEnable is false',
    });
  });
});
