/**
 * Frontmatter Parser
 *
 * Parses YAML frontmatter from skill markdown files.
 */

import yaml from 'yaml';
import type { SkillFrontmatter } from '../types.js';

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n/;

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  content: string;
}

export function parseSkillFrontmatter(markdown: string): ParsedSkill {
  const match = markdown.match(FRONTMATTER_REGEX);

  if (!match) {
    return {
      frontmatter: {},
      content: markdown.trim()
    };
  }

  const frontmatterYaml = match[1];
  const content = markdown.slice(match[0].length).trim();

  try {
    const parsed = yaml.parse(frontmatterYaml) as SkillFrontmatter;
    return {
      frontmatter: parsed || {},
      content
    };
  } catch (error) {
    console.warn('[Skills] Failed to parse frontmatter:', error);
    return {
      frontmatter: {},
      content
    };
  }
}

export function validateFrontmatter(frontmatter: SkillFrontmatter): string[] {
  const errors: string[] = [];

  if (frontmatter.metadata?.squire?.install) {
    for (const step of frontmatter.metadata.squire.install) {
      if (!step.type || !step.package) {
        errors.push(`Invalid install step: missing type or package`);
      }

      if (!['brew', 'npm', 'go', 'uv', 'download'].includes(step.type)) {
        errors.push(`Unknown install type: ${step.type}`);
      }
    }
  }

  return errors;
}

export function extractSkillName(filePath: string): string {
  const parts = filePath.split('/');
  const dirName = parts[parts.length - 2] || 'unknown';
  return dirName;
}
