import { describe, it, expect } from 'vitest';
import { parseSkillFrontmatter, validateFrontmatter, extractSkillName } from './frontmatter.js';
import type { SkillFrontmatter } from '../types.js';

describe('Frontmatter Parser', () => {
  describe('parseSkillFrontmatter', () => {
    it('should parse skill with valid frontmatter', () => {
      const markdown = `---
name: Test Skill
description: A test skill
version: 1.0.0
---

# Test Skill Content

This is the skill content.`;

      const result = parseSkillFrontmatter(markdown);

      expect(result.frontmatter.name).toBe('Test Skill');
      expect(result.frontmatter.description).toBe('A test skill');
      expect(result.frontmatter.version).toBe('1.0.0');
      expect(result.content).toBe('# Test Skill Content\n\nThis is the skill content.');
    });

    it('should return empty frontmatter for markdown without frontmatter', () => {
      const markdown = `# No Frontmatter

Just regular markdown.`;

      const result = parseSkillFrontmatter(markdown);

      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe('# No Frontmatter\n\nJust regular markdown.');
    });

    it('should parse complex frontmatter with metadata', () => {
      const markdown = `---
name: Complex Skill
metadata:
  squire:
    requires:
      bins:
        - node
        - npm
      env:
        - API_KEY
    install:
      - type: npm
        package: some-package
---

Content here`;

      const result = parseSkillFrontmatter(markdown);

      expect(result.frontmatter.name).toBe('Complex Skill');
      expect(result.frontmatter.metadata?.squire?.requires?.bins).toContain('node');
      expect(result.frontmatter.metadata?.squire?.install?.[0]?.type).toBe('npm');
    });

    it('should handle invalid YAML gracefully', () => {
      const markdown = `---
invalid: [yaml: syntax
---

Content`;

      const result = parseSkillFrontmatter(markdown);

      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe('Content');
    });

    it('should parse frontmatter with arrays', () => {
      const markdown = `---
tags:
  - productivity
  - automation
triggers:
  - schedule
  - manual
---

Content`;

      const result = parseSkillFrontmatter(markdown);

      expect(result.frontmatter.tags).toContain('productivity');
      expect(result.frontmatter.triggers).toContain('manual');
    });

    it('should handle empty frontmatter', () => {
      const markdown = `---
---
Content`;

      const result = parseSkillFrontmatter(markdown);

      expect(result.frontmatter).toEqual({});
      // Empty frontmatter still gets parsed, content may include frontmatter delimiters
      expect(result.content).toContain('Content');
    });
  });

  describe('validateFrontmatter', () => {
    it('should return empty errors for valid frontmatter', () => {
      const frontmatter: SkillFrontmatter = {
        name: 'Valid Skill',
        metadata: {
          squire: {
            install: [
              { type: 'npm', package: 'lodash' },
            ],
          },
        },
      };

      const errors = validateFrontmatter(frontmatter);
      expect(errors).toEqual([]);
    });

    it('should validate install step missing type', () => {
      const frontmatter: SkillFrontmatter = {
        metadata: {
          squire: {
            install: [
              { package: 'some-package' } as never,
            ],
          },
        },
      };

      const errors = validateFrontmatter(frontmatter);
      expect(errors).toContain('Invalid install step: missing type or package');
    });

    it('should validate install step missing package', () => {
      const frontmatter: SkillFrontmatter = {
        metadata: {
          squire: {
            install: [
              { type: 'npm' } as never,
            ],
          },
        },
      };

      const errors = validateFrontmatter(frontmatter);
      expect(errors).toContain('Invalid install step: missing type or package');
    });

    it('should validate unknown install type', () => {
      const frontmatter: SkillFrontmatter = {
        metadata: {
          squire: {
            install: [
              { type: 'unknown-type', package: 'some-package' },
            ],
          },
        },
      };

      const errors = validateFrontmatter(frontmatter);
      expect(errors).toContain('Unknown install type: unknown-type');
    });

    it('should accept all valid install types', () => {
      const types = ['brew', 'npm', 'go', 'uv', 'download'];

      for (const type of types) {
        const frontmatter: SkillFrontmatter = {
          metadata: {
            squire: {
              install: [{ type, package: 'test' }],
            },
          },
        };

        const errors = validateFrontmatter(frontmatter);
        expect(errors).toEqual([]);
      }
    });

    it('should return empty errors for frontmatter without install', () => {
      const frontmatter: SkillFrontmatter = {
        name: 'Simple Skill',
        description: 'No install needed',
      };

      const errors = validateFrontmatter(frontmatter);
      expect(errors).toEqual([]);
    });
  });

  describe('extractSkillName', () => {
    it('should extract skill name from directory path', () => {
      // The loader passes directory paths, not file paths
      expect(extractSkillName('/skills/memory')).toBe('memory');
      expect(extractSkillName('/home/user/.squire/skills/web')).toBe('web');
      expect(extractSkillName('./skills/github')).toBe('github');
    });

    it('should handle empty path', () => {
      expect(extractSkillName('')).toBe('unknown');
    });
  });
});
