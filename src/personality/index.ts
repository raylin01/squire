/**
 * Personality Manager
 *
 * Manages Squire's personality configuration with global defaults
 * and per-workspace overrides.
 */

import type { Personality, PersonalityConfig, PersonalityTraits } from '../types.js';
import { PERSONALITY_TEMPLATES, getPersonalityTemplate } from './templates.js';

export { PERSONALITY_TEMPLATES, getPersonalityTemplate, getPersonalityTemplateList, TRAIT_DESCRIPTIONS, getTraitDescription } from './templates.js';
export type { PersonalityTemplateName } from './templates.js';

export class PersonalityManager {
  private config: PersonalityConfig;

  constructor(config?: PersonalityConfig) {
    this.config = config || {
      default: PERSONALITY_TEMPLATES.helpful,
      workspaceOverrides: {},
    };
  }

  /**
   * Update the personality configuration
   */
  setConfig(config: PersonalityConfig): void {
    this.config = config;
  }

  /**
   * Get the current configuration
   */
  getConfig(): PersonalityConfig {
    return this.config;
  }

  /**
   * Get the effective personality for a workspace
   * Falls back to default if no override exists
   */
  getPersonality(workspaceId?: string): Personality {
    if (!workspaceId) {
      return this.config.default;
    }

    const override = this.config.workspaceOverrides[workspaceId];
    if (!override) {
      return this.config.default;
    }

    // Merge override with default
    return this.mergePersonalities(this.config.default, override);
  }

  /**
   * Get the default personality
   */
  getDefault(): Personality {
    return this.config.default;
  }

  /**
   * Set the default personality
   */
  setDefault(personality: Personality): void {
    this.config.default = personality;
  }

  /**
   * Set the default personality from a template
   */
  setDefaultFromTemplate(templateName: keyof typeof PERSONALITY_TEMPLATES): boolean {
    const template = getPersonalityTemplate(templateName);
    if (template) {
      this.config.default = { ...template };
      return true;
    }
    return false;
  }

  /**
   * Set a workspace personality override
   */
  setWorkspaceOverride(workspaceId: string, override: Partial<Personality>): void {
    this.config.workspaceOverrides[workspaceId] = override;
  }

  /**
   * Clear a workspace override
   */
  clearWorkspaceOverride(workspaceId: string): void {
    delete this.config.workspaceOverrides[workspaceId];
  }

  /**
   * Get all workspace overrides
   */
  getWorkspaceOverrides(): Record<string, Partial<Personality>> {
    return { ...this.config.workspaceOverrides };
  }

  /**
   * Build a system prompt based on personality
   */
  buildSystemPrompt(personality: Personality): string {
    const { name, traits, customInstructions } = personality;

    const traitInstructions = this.buildTraitInstructions(traits);

    let prompt = `You are ${name}.\n\n${traitInstructions}`;

    if (customInstructions) {
      prompt += `\n\nAdditional instructions:\n${customInstructions}`;
    }

    return prompt;
  }

  /**
   * Build trait-specific instructions
   */
  private buildTraitInstructions(traits: PersonalityTraits): string {
    const instructions: string[] = [];

    // Tone
    switch (traits.tone) {
      case 'professional':
        instructions.push('Maintain a professional, business-like tone.');
        break;
      case 'casual':
        instructions.push('Keep the conversation casual and relaxed.');
        break;
      case 'friendly':
        instructions.push('Be warm, friendly, and approachable in your responses.');
        break;
      case 'formal':
        instructions.push('Use formal language and maintain proper etiquette.');
        break;
    }

    // Verbosity
    switch (traits.verbosity) {
      case 'concise':
        instructions.push('Be concise. Get to the point quickly without unnecessary elaboration.');
        break;
      case 'balanced':
        instructions.push('Provide balanced responses - neither too brief nor overly verbose.');
        break;
      case 'detailed':
        instructions.push('Provide detailed, comprehensive responses. Cover all relevant aspects.');
        break;
    }

    // Technicality
    switch (traits.technicality) {
      case 'simple':
        instructions.push('Use simple language. Avoid technical jargon unless necessary, and explain it when used.');
        break;
      case 'moderate':
        instructions.push('Balance technical depth with accessibility.');
        break;
      case 'expert':
        instructions.push('Use technical terminology freely. Assume the user has domain expertise.');
        break;
    }

    // Enthusiasm
    switch (traits.enthusiasm) {
      case 'reserved':
        instructions.push('Keep your emotional expression reserved and measured.');
        break;
      case 'neutral':
        instructions.push('Maintain a neutral emotional tone.');
        break;
      case 'enthusiastic':
        instructions.push('Be enthusiastic and positive in your interactions.');
        break;
    }

    // Humor
    switch (traits.humor) {
      case 'none':
        instructions.push('Be serious at all times. Avoid humor.');
        break;
      case 'subtle':
        instructions.push('Occasional light humor is acceptable.');
        break;
      case 'moderate':
        instructions.push('Feel free to use humor to keep interactions engaging.');
        break;
    }

    return instructions.join('\n');
  }

  /**
   * Merge a partial personality override with a base personality
   */
  private mergePersonalities(base: Personality, override: Partial<Personality>): Personality {
    return {
      name: override.name || base.name,
      description: override.description || base.description,
      traits: {
        ...base.traits,
        ...(override.traits || {}),
      },
      customInstructions: override.customInstructions ?? base.customInstructions,
    };
  }
}

/**
 * Create a personality manager instance
 */
export function createPersonalityManager(config?: PersonalityConfig): PersonalityManager {
  return new PersonalityManager(config);
}
