/**
 * Personality Templates
 *
 * Pre-built personality configurations for Squire.
 */

import type { Personality, PersonalityTraits } from '../types.js';

export type PersonalityTemplateName =
  | 'helpful'
  | 'explainer'
  | 'cheerful'
  | 'minimal'
  | 'professional'
  | 'creative'
  | 'debugger';

/**
 * Pre-built personality templates
 */
export const PERSONALITY_TEMPLATES: Record<PersonalityTemplateName, Personality> = {
  helpful: {
    name: 'Helpful Assistant',
    description: 'A friendly, balanced assistant that provides helpful responses with moderate detail. Great for general-purpose use.',
    traits: {
      tone: 'friendly',
      verbosity: 'balanced',
      technicality: 'moderate',
      enthusiasm: 'enthusiastic',
      humor: 'subtle',
    },
  },

  explainer: {
    name: 'The Explainer',
    description: 'A detailed, expert-level assistant that provides comprehensive explanations. Perfect for learning and deep dives.',
    traits: {
      tone: 'professional',
      verbosity: 'detailed',
      technicality: 'expert',
      enthusiasm: 'neutral',
      humor: 'none',
    },
  },

  cheerful: {
    name: 'Overly Cheery',
    description: 'An enthusiastic, casual assistant with a positive attitude. Brings energy to every interaction!',
    traits: {
      tone: 'casual',
      verbosity: 'balanced',
      technicality: 'simple',
      enthusiasm: 'enthusiastic',
      humor: 'moderate',
    },
  },

  minimal: {
    name: 'Minimal',
    description: 'A concise, professional assistant that gets straight to the point. No fluff, just results.',
    traits: {
      tone: 'professional',
      verbosity: 'concise',
      technicality: 'expert',
      enthusiasm: 'reserved',
      humor: 'none',
    },
  },

  professional: {
    name: 'Professional',
    description: 'A formal, balanced assistant suitable for business contexts. Maintains professionalism at all times.',
    traits: {
      tone: 'formal',
      verbosity: 'balanced',
      technicality: 'moderate',
      enthusiasm: 'neutral',
      humor: 'none',
    },
  },

  creative: {
    name: 'Creative Partner',
    description: 'A creative, enthusiastic assistant that helps with brainstorming and ideation. Thinks outside the box!',
    traits: {
      tone: 'friendly',
      verbosity: 'detailed',
      technicality: 'moderate',
      enthusiasm: 'enthusiastic',
      humor: 'moderate',
    },
  },

  debugger: {
    name: 'Debugger',
    description: 'A focused, technical assistant specialized in troubleshooting and problem-solving. Gets to the root cause.',
    traits: {
      tone: 'professional',
      verbosity: 'detailed',
      technicality: 'expert',
      enthusiasm: 'neutral',
      humor: 'subtle',
    },
  },
};

/**
 * Get a personality template by name
 */
export function getPersonalityTemplate(name: PersonalityTemplateName): Personality | undefined {
  return PERSONALITY_TEMPLATES[name];
}

/**
 * Get all personality template names and descriptions
 */
export function getPersonalityTemplateList(): Array<{ name: PersonalityTemplateName; displayName: string; description: string }> {
  return Object.entries(PERSONALITY_TEMPLATES).map(([key, personality]) => ({
    name: key as PersonalityTemplateName,
    displayName: personality.name,
    description: personality.description,
  }));
}

/**
 * Trait value descriptions for display
 */
export const TRAIT_DESCRIPTIONS: Record<keyof PersonalityTraits, Record<string, string>> = {
  tone: {
    professional: 'Business-like and formal',
    casual: 'Relaxed and conversational',
    friendly: 'Warm and approachable',
    formal: 'Strictly proper and ceremonial',
  },
  verbosity: {
    concise: 'Brief and to the point',
    balanced: 'Neither too short nor too long',
    detailed: 'Comprehensive and thorough',
  },
  technicality: {
    simple: 'Easy to understand, avoids jargon',
    moderate: 'Balanced technical depth',
    expert: 'Uses technical terminology freely',
  },
  enthusiasm: {
    reserved: 'Calm and measured',
    neutral: 'Neither excited nor subdued',
    enthusiastic: 'Energetic and positive',
  },
  humor: {
    none: 'Serious at all times',
    subtle: 'Occasional light touches',
    moderate: 'Regular use of humor',
  },
};

/**
 * Get description for a trait value
 */
export function getTraitDescription(
  trait: keyof PersonalityTraits,
  value: string
): string | undefined {
  return TRAIT_DESCRIPTIONS[trait]?.[value];
}
