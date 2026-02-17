/**
 * Skill Loader
 *
 * Loads skills from multiple directories with priority ordering.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Skill, SkillFrontmatter } from '../types.js';
import { parseSkillFrontmatter, extractSkillName } from './frontmatter.js';
import { checkEligibility } from './eligibility.js';

export interface SkillLoaderOptions {
  skillsDir?: string;
  bundledDir?: string;
}

// Priority order (highest to lowest)
const SKILL_FILE_NAMES = ['SKILL.md', 'skill.md', 'README.md'];

export class SkillLoader {
  private skillsDir: string;
  private bundledDir: string;
  private skills: Map<string, Skill> = new Map();

  constructor(options: SkillLoaderOptions = {}) {
    this.skillsDir = options.skillsDir || path.join(os.homedir(), '.squire', 'skills');
    this.bundledDir = options.bundledDir || path.join(__dirname, 'bundled');
  }

  /**
   * Load all skills from all sources
   */
  async loadAll(): Promise<Skill[]> {
    this.skills.clear();

    // Load in priority order (lowest to highest, so higher overwrites)
    await this.loadFromDirectory(this.bundledDir, 'bundled');
    await this.loadFromDirectory(path.join(process.cwd(), '.agents', 'skills'), 'project');
    await this.loadFromDirectory(this.skillsDir, 'user');

    return Array.from(this.skills.values());
  }

  /**
   * Load a single skill by name
   */
  async load(skillName: string): Promise<Skill | null> {
    // Try in priority order (user > project > bundled)
    const sources = [
      { dir: this.skillsDir, type: 'user' as const },
      { dir: path.join(process.cwd(), '.agents', 'skills'), type: 'project' as const },
      { dir: this.bundledDir, type: 'bundled' as const },
    ];

    for (const source of sources) {
      const skill = await this.loadFromPath(path.join(source.dir, skillName), source.type);
      if (skill) {
        return skill;
      }
    }

    return null;
  }

  /**
   * Get all loaded skills
   */
  getLoaded(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a loaded skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Load skills from a directory
   */
  private async loadFromDirectory(dir: string, source: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(dir, entry.name);
      await this.loadFromPath(skillDir, source);
    }
  }

  /**
   * Load a skill from a specific path
   */
  private async loadFromPath(skillDir: string, source: string): Promise<Skill | null> {
    if (!fs.existsSync(skillDir)) {
      return null;
    }

    // Find skill file
    let skillFile: string | null = null;
    for (const name of SKILL_FILE_NAMES) {
      const filePath = path.join(skillDir, name);
      if (fs.existsSync(filePath)) {
        skillFile = filePath;
        break;
      }
    }

    if (!skillFile) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillFile, 'utf-8');
      const { frontmatter, content: body } = parseSkillFrontmatter(content);

      const name = frontmatter.name || extractSkillName(skillDir);
      const eligibility = checkEligibility(frontmatter);

      const skill: Skill = {
        name,
        description: frontmatter.description || '',
        path: skillDir,
        frontmatter,
        content: body,
        eligible: eligibility.eligible,
        eligibilityReason: eligibility.reason,
      };

      // Add to map (overwrites if same name from lower priority source)
      this.skills.set(name, skill);

      return skill;
    } catch (error) {
      console.error(`[Skills] Failed to load skill from ${skillDir}:`, error);
      return null;
    }
  }
}

/**
 * Create a skill loader instance
 */
export function createSkillLoader(options?: SkillLoaderOptions): SkillLoader {
  return new SkillLoader(options);
}
