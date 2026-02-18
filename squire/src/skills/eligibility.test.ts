import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkEligibility,
  isBinaryAvailable,
  getPlatform,
  isMacOS,
  isLinux,
  isWindows,
} from './eligibility.js';
import type { SkillFrontmatter } from '../types.js';

describe('Eligibility Checker', () => {
  describe('checkEligibility', () => {
    it('should return eligible for skill without requirements', () => {
      const frontmatter: SkillFrontmatter = {
        name: 'Simple Skill',
        description: 'No requirements',
      };

      const result = checkEligibility(frontmatter);

      expect(result.eligible).toBe(true);
      expect(result.missingBins).toEqual([]);
      expect(result.missingEnv).toEqual([]);
    });

    it('should detect missing binaries', () => {
      const frontmatter: SkillFrontmatter = {
        name: 'Binary Skill',
        metadata: {
          squire: {
            requires: {
              bins: ['nonexistent-binary-xyz123'],
            },
          },
        },
      };

      const result = checkEligibility(frontmatter);

      expect(result.eligible).toBe(false);
      expect(result.missingBins).toContain('nonexistent-binary-xyz123');
      expect(result.reason).toContain('nonexistent-binary-xyz123');
    });

    it('should detect missing environment variables', () => {
      const frontmatter: SkillFrontmatter = {
        name: 'Env Skill',
        metadata: {
          squire: {
            requires: {
              env: ['NONEXISTENT_ENV_VAR_XYZ123'],
            },
          },
        },
      };

      const result = checkEligibility(frontmatter);

      expect(result.eligible).toBe(false);
      expect(result.missingEnv).toContain('NONEXISTENT_ENV_VAR_XYZ123');
    });

    it('should return eligible when all requirements are met', () => {
      // node should be available in test environment
      const frontmatter: SkillFrontmatter = {
        name: 'Node Skill',
        metadata: {
          squire: {
            requires: {
              bins: ['node'],
            },
          },
        },
      };

      const result = checkEligibility(frontmatter);

      expect(result.eligible).toBe(true);
      expect(result.missingBins).toEqual([]);
    });

    it('should check both bins and env', () => {
      const frontmatter: SkillFrontmatter = {
        name: 'Complex Skill',
        metadata: {
          squire: {
            requires: {
              bins: ['nonexistent-bin'],
              env: ['NONEXISTENT_VAR'],
            },
          },
        },
      };

      const result = checkEligibility(frontmatter);

      expect(result.eligible).toBe(false);
      expect(result.missingBins).toContain('nonexistent-bin');
      expect(result.missingEnv).toContain('NONEXISTENT_VAR');
      expect(result.reason).toContain('bins=');
      expect(result.reason).toContain('env=');
    });

    it('should find existing env vars', () => {
      process.env.TEST_ELIGIBILITY_VAR = 'test-value';

      const frontmatter: SkillFrontmatter = {
        name: 'Env Test',
        metadata: {
          squire: {
            requires: {
              env: ['TEST_ELIGIBILITY_VAR'],
            },
          },
        },
      };

      const result = checkEligibility(frontmatter);

      expect(result.eligible).toBe(true);
      expect(result.missingEnv).toEqual([]);

      delete process.env.TEST_ELIGIBILITY_VAR;
    });
  });

  describe('isBinaryAvailable', () => {
    it('should find node binary', () => {
      // node should be available in test environment
      expect(isBinaryAvailable('node')).toBe(true);
    });

    it('should return false for nonexistent binary', () => {
      expect(isBinaryAvailable('nonexistent-binary-xyz123')).toBe(false);
    });

    it('should find common system binaries', () => {
      // These should be available on most systems
      expect(isBinaryAvailable('ls')).toBe(true);
      expect(isBinaryAvailable('cat')).toBe(true);
    });
  });

  describe('getPlatform', () => {
    it('should return a valid platform', () => {
      const platform = getPlatform();
      expect(['darwin', 'linux', 'windows', 'unknown']).toContain(platform);
    });
  });

  describe('platform helpers', () => {
    it('isMacOS should match platform', () => {
      const platform = getPlatform();
      expect(isMacOS()).toBe(platform === 'darwin');
    });

    it('isLinux should match platform', () => {
      const platform = getPlatform();
      expect(isLinux()).toBe(platform === 'linux');
    });

    it('isWindows should match platform', () => {
      const platform = getPlatform();
      expect(isWindows()).toBe(platform === 'windows');
    });

    it('exactly one platform should be true', () => {
      const platforms = [isMacOS(), isLinux(), isWindows()];
      const trueCount = platforms.filter(Boolean).length;

      // On darwin/linux/win32, exactly one should be true
      // On unknown platforms, all could be false
      expect(trueCount).toBeLessThanOrEqual(1);
    });
  });
});
