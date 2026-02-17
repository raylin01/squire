/**
 * Skills Module
 *
 * Provides skill loading, parsing, and management.
 */

export { SkillManager, createSkillManager } from './manager.js';
export type { SkillManagerOptions } from './manager.js';
export { SkillLoader, createSkillLoader } from './loader.js';
export { parseSkillFrontmatter, validateFrontmatter } from './frontmatter.js';
export { checkEligibility, isBinaryAvailable } from './eligibility.js';
export { installDependencies, canAutoInstall } from './installer.js';
