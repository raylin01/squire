/**
 * Personality Builder
 *
 * LLM-powered interactive personality builder.
 * Helps users create custom personalities through natural language interaction.
 */

import type { Personality, PersonalityTraits } from '../types.js';
import { PERSONALITY_TEMPLATES, PersonalityTemplateName } from './templates.js';

export interface BuilderQuestion {
  id: string;
  question: string;
  options?: Array<{ value: string; label: string; description: string }>;
  type: 'select' | 'text';
}

/**
 * Questions for the interactive builder
 */
export const BUILDER_QUESTIONS: BuilderQuestion[] = [
  {
    id: 'tone',
    question: 'How should Squire communicate with you?',
    type: 'select',
    options: [
      { value: 'friendly', label: 'Friendly', description: 'Warm and approachable' },
      { value: 'professional', label: 'Professional', description: 'Business-like and efficient' },
      { value: 'casual', label: 'Casual', description: 'Relaxed and conversational' },
      { value: 'formal', label: 'Formal', description: 'Strictly proper' },
    ],
  },
  {
    id: 'verbosity',
    question: 'How detailed should responses be?',
    type: 'select',
    options: [
      { value: 'concise', label: 'Concise', description: 'Brief and to the point' },
      { value: 'balanced', label: 'Balanced', description: 'Neither too short nor too long' },
      { value: 'detailed', label: 'Detailed', description: 'Comprehensive and thorough' },
    ],
  },
  {
    id: 'technicality',
    question: 'What level of technical depth do you prefer?',
    type: 'select',
    options: [
      { value: 'simple', label: 'Simple', description: 'Easy to understand, avoids jargon' },
      { value: 'moderate', label: 'Moderate', description: 'Balanced technical depth' },
      { value: 'expert', label: 'Expert', description: 'Uses technical terminology freely' },
    ],
  },
  {
    id: 'enthusiasm',
    question: 'How enthusiastic should Squire be?',
    type: 'select',
    options: [
      { value: 'reserved', label: 'Reserved', description: 'Calm and measured' },
      { value: 'neutral', label: 'Neutral', description: 'Neither excited nor subdued' },
      { value: 'enthusiastic', label: 'Enthusiastic', description: 'Energetic and positive' },
    ],
  },
  {
    id: 'humor',
    question: 'Should Squire use humor?',
    type: 'select',
    options: [
      { value: 'none', label: 'No humor', description: 'Serious at all times' },
      { value: 'subtle', label: 'Subtle', description: 'Occasional light touches' },
      { value: 'moderate', label: 'Moderate', description: 'Regular use of humor' },
    ],
  },
  {
    id: 'name',
    question: 'What would you like to name this personality?',
    type: 'text',
  },
  {
    id: 'customInstructions',
    question: 'Any additional instructions for Squire? (optional)',
    type: 'text',
  },
];

/**
 * Build a personality from builder answers
 */
export function buildPersonalityFromAnswers(answers: Record<string, string>): Personality {
  const traits: PersonalityTraits = {
    tone: (answers.tone || 'friendly') as PersonalityTraits['tone'],
    verbosity: (answers.verbosity || 'balanced') as PersonalityTraits['verbosity'],
    technicality: (answers.technicality || 'moderate') as PersonalityTraits['technicality'],
    enthusiasm: (answers.enthusiasm || 'neutral') as PersonalityTraits['enthusiasm'],
    humor: (answers.humor || 'subtle') as PersonalityTraits['humor'],
  };

  return {
    name: answers.name || 'Custom Personality',
    description: generateDescription(traits),
    traits,
    customInstructions: answers.customInstructions || undefined,
  };
}

/**
 * Generate a description based on traits
 */
function generateDescription(traits: PersonalityTraits): string {
  const parts: string[] = [];

  // Tone
  const toneDesc: Record<string, string> = {
    friendly: 'friendly and approachable',
    professional: 'professional and business-like',
    casual: 'casual and relaxed',
    formal: 'formal and proper',
  };

  // Verbosity
  const verbosityDesc: Record<string, string> = {
    concise: 'concise, to-the-point',
    balanced: 'balanced',
    detailed: 'detailed and thorough',
  };

  // Technicality
  const techDesc: Record<string, string> = {
    simple: 'uses simple language',
    moderate: 'uses moderate technical depth',
    expert: 'uses expert-level terminology',
  };

  parts.push(`A ${toneDesc[traits.tone]} assistant`);
  parts.push(`that provides ${verbosityDesc[traits.verbosity]} responses`);
  parts.push(`and ${techDesc[traits.technicality]}.`);

  if (traits.enthusiasm === 'enthusiastic') {
    parts.push('Brings energy and enthusiasm to interactions.');
  } else if (traits.enthusiasm === 'reserved') {
    parts.push('Maintains a calm, measured demeanor.');
  }

  if (traits.humor === 'moderate') {
    parts.push('Uses humor to keep things engaging.');
  } else if (traits.humor === 'none') {
    parts.push('Stays focused and serious.');
  }

  return parts.join(' ');
}

/**
 * Suggest a personality based on a natural language description
 */
export function suggestPersonality(description: string): PersonalityTemplateName | null {
  const desc = description.toLowerCase();

  // Check for keyword matches
  const keywords: Record<PersonalityTemplateName, string[]> = {
    helpful: ['helpful', 'general', 'normal', 'standard', 'default'],
    explainer: ['explain', 'teach', 'learn', 'detailed', 'deep', 'thorough', 'comprehensive'],
    cheerful: ['happy', 'cheerful', 'positive', 'fun', 'energetic', 'enthusiastic', 'bubbly'],
    minimal: ['minimal', 'concise', 'short', 'brief', 'efficient', 'quick', 'to the point'],
    professional: ['professional', 'business', 'corporate', 'formal', 'work'],
    creative: ['creative', 'brainstorm', 'ideas', 'innovative', 'imaginative'],
    debugger: ['debug', 'troubleshoot', 'fix', 'solve', 'technical', 'problem'],
  };

  let bestMatch: PersonalityTemplateName | null = null;
  let bestScore = 0;

  for (const [name, words] of Object.entries(keywords)) {
    let score = 0;
    for (const word of words) {
      if (desc.includes(word)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = name as PersonalityTemplateName;
    }
  }

  return bestMatch;
}

/**
 * Get a prompt for LLM-based personality building
 */
export function getPersonalityBuilderPrompt(userDescription: string): string {
  return `The user wants to create a custom AI personality. Here is their description:

"${userDescription}"

Based on this description, suggest a personality configuration with:
1. A name for the personality
2. A description
3. Trait settings (tone, verbosity, technicality, enthusiasm, humor)
4. Any custom instructions

Available trait options:
- tone: professional, casual, friendly, formal
- verbosity: concise, balanced, detailed
- technicality: simple, moderate, expert
- enthusiasm: reserved, neutral, enthusiastic
- humor: none, subtle, moderate

Respond with a JSON object in this format:
{
  "name": "Personality Name",
  "description": "Description of the personality",
  "traits": {
    "tone": "friendly",
    "verbosity": "balanced",
    "technicality": "moderate",
    "enthusiasm": "neutral",
    "humor": "subtle"
  },
  "customInstructions": "Any additional instructions"
}`;
}
