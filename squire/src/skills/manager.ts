/**
 * Skill Manager
 *
 * Main manager for loading, validating, and auto-installing skills.
 */

import type { Skill, SkillsConfig, SkillFrontmatter } from '../types.js';
import { SkillLoader, createSkillLoader } from './loader.js';
import { checkEligibility } from './eligibility.js';
import { installDependencies, canAutoInstall } from './installer.js';
import { validateFrontmatter } from './frontmatter.js';

export interface SkillManagerOptions {
  config: SkillsConfig;
  skillsDir: string;
}

export class SkillManager {
  private config: SkillsConfig;
  private loader: SkillLoader;
  private skills: Map<string, Skill> = new Map();
  private initialized: boolean = false;

  constructor(options: SkillManagerOptions) {
    this.config = options.config;
    this.loader = createSkillLoader({ skillsDir: options.skillsDir });
  }

  /**
   * Initialize the skill manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[Skills] Loading skills...');

    // Load all skills
    const skills = await this.loader.loadAll();

    // Filter to configured skills
    const enabledSkills = this.filterEnabled(skills);

    // Auto-install dependencies if enabled
    if (this.config.autoInstall) {
      await this.autoInstallDependencies(enabledSkills);
    }

    // Store eligible skills
    for (const skill of enabledSkills) {
      if (skill.eligible) {
        this.skills.set(skill.name, skill);
        console.log(`[Skills] Loaded: ${skill.name}`);
      } else {
        console.log(`[Skills] Skipped (not eligible): ${skill.name} - ${skill.eligibilityReason}`);
      }
    }

    this.initialized = true;
    console.log(`[Skills] Initialized with ${this.skills.size} skills`);
  }

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a specific skill
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Load a skill from a specific path
   */
  async loadSkill(skillPath: string): Promise<Skill> {
    const skills = await this.loader.loadAll();

    // Try to find the skill
    for (const skill of skills) {
      if (skill.path === skillPath || skill.name === skillPath) {
        if (!skill.eligible && this.config.autoInstall) {
          await this.autoInstallSkill(skill);
        }

        if (skill.eligible) {
          this.skills.set(skill.name, skill);
          return skill;
        }

        throw new Error(`Skill not eligible: ${skill.eligibilityReason}`);
      }
    }

    throw new Error(`Skill not found: ${skillPath}`);
  }

  /**
   * Check if a skill is available
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get skill content for AI context
   */
  getSkillContext(skillNames?: string[]): string {
    const skills = skillNames
      ? skillNames.map(name => this.skills.get(name)).filter(Boolean) as Skill[]
      : Array.from(this.skills.values());

    return skills.map(skill => {
      const header = `## Skill: ${skill.name}\n${skill.description ? skill.description + '\n' : ''}`;
      return header + skill.content;
    }).join('\n\n---\n\n');
  }

  /**
   * Filter skills based on configuration
   */
  private filterEnabled(skills: Skill[]): Skill[] {
    const bundled = new Set(this.config.bundled);
    const additional = new Set(this.config.additional);

    return skills.filter(skill => {
      // Check if in bundled or additional lists
      if (bundled.has(skill.name) || additional.has(skill.name)) {
        return true;
      }

      // Check if name matches any additional patterns
      for (const pattern of this.config.additional) {
        if (skill.name.includes(pattern) || pattern === '*') {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Auto-install dependencies for skills
   */
  private async autoInstallDependencies(skills: Skill[]): Promise<void> {
    if (!canAutoInstall()) {
      console.log('[Skills] No package managers available for auto-install');
      return;
    }

    for (const skill of skills) {
      if (!skill.eligible) {
        await this.autoInstallSkill(skill);
      }
    }
  }

  /**
   * Auto-install dependencies for a single skill
   */
  private async autoInstallSkill(skill: Skill): Promise<void> {
    const install = skill.frontmatter.metadata?.squire?.install;

    if (!install || install.length === 0) {
      return;
    }

    console.log(`[Skills] Auto-installing dependencies for ${skill.name}...`);

    const results = await installDependencies(install);

    // Re-check eligibility after install
    const eligibility = checkEligibility(skill.frontmatter);
    skill.eligible = eligibility.eligible;
    skill.eligibilityReason = eligibility.reason;

    if (skill.eligible) {
      console.log(`[Skills] ${skill.name} is now eligible`);
    }
  }
}

/**
 * Create a skill manager instance
 */
export function createSkillManager(options: SkillManagerOptions): SkillManager {
  return new SkillManager(options);
}
