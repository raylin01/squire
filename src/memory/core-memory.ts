/**
 * Core Memory Manager
 *
 * Manages long-term curated memories: preferences, facts, decisions, patterns.
 * Stored in MEMORY.md as human-readable Markdown.
 * Uses QMD for semantic search across core memories.
 *
 * Format inspired by OpenClaw:
 *
 * # Memory: [Squire Name]
 *
 * ## Preferences
 * - I prefer TypeScript over JavaScript
 * - I like concise responses
 *
 * ## Facts
 * - I work at [Company]
 * - My main project is DisCode
 *
 * ## Decisions
 * - We chose WebSocket for real-time sync (2025-01-15)
 *   Reason: Better UX than polling
 *
 * ## Patterns
 * - I code late at night
 * - I prefer to review changes before committing
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type {
  CoreMemoryEntry,
  CoreMemoryType,
  CoreMemorySection,
} from './types.js';
import type { MemorySource } from '../types.js';

export interface CoreMemoryOptions {
  memoryDir: string;
  squireName: string;
}

const SECTION_CONFIG: Record<CoreMemoryType, { title: string; description: string }> = {
  preference: { title: 'Preferences', description: 'What the user prefers' },
  fact: { title: 'Facts', description: 'Objective facts about the user' },
  decision: { title: 'Decisions', description: 'Past decisions and their rationale' },
  pattern: { title: 'Patterns', description: 'Observed patterns in behavior' },
  skill: { title: 'Skills', description: 'Skills and technologies known' },
  contact: { title: 'Contacts', description: 'Important contacts' },
  project: { title: 'Projects', description: 'Project knowledge' },
};

export class CoreMemoryManager {
  private memoryDir: string;
  private squireName: string;
  private memoryFile: string;
  private entries: Map<string, CoreMemoryEntry> = new Map();
  private loaded: boolean = false;

  constructor(options: CoreMemoryOptions) {
    this.memoryDir = options.memoryDir;
    this.squireName = options.squireName;
    this.memoryFile = path.join(this.memoryDir, 'MEMORY.md');

    // Ensure directory exists
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  /**
   * Load core memory from file
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    if (!fs.existsSync(this.memoryFile)) {
      // Create default file
      await this.createDefaultFile();
      this.loaded = true;
      return;
    }

    const content = fs.readFileSync(this.memoryFile, 'utf-8');
    this.parseMarkdown(content);
    this.loaded = true;
  }

  /**
   * Create default MEMORY.md file
   */
  private async createDefaultFile(): Promise<void> {
    const lines: string[] = [
      `# Memory: ${this.squireName}`,
      '',
      '> Core memory for long-term facts, preferences, and decisions.',
      '> This file is curated and should contain only important, lasting information.',
      '',
      '## Preferences',
      '',
      '_User preferences and likes_',
      '',
      '## Facts',
      '',
      '_Objective facts about the user_',
      '',
      '## Decisions',
      '',
      '_Past decisions with rationale_',
      '',
      '## Skills',
      '',
      '_Technologies and skills the user knows_',
      '',
      '## Projects',
      '',
      '_Project knowledge and context_',
      '',
      '---',
      '',
      `_Last updated: ${new Date().toISOString()}_`,
    ];

    fs.writeFileSync(this.memoryFile, lines.join('\n'), 'utf-8');
  }

  /**
   * Add a new core memory entry
   */
  async add(
    content: string,
    options?: {
      type?: CoreMemoryType;
      source?: MemorySource;
      workspaceId?: string;
      tags?: string[];
      confidence?: number;
      evidence?: string;
    }
  ): Promise<CoreMemoryEntry> {
    await this.load();

    const entry: CoreMemoryEntry = {
      id: uuid(),
      type: options?.type || 'fact',
      content,
      confidence: options?.confidence ?? 1.0,
      source: options?.source || 'user',
      workspaceId: options?.workspaceId,
      tags: options?.tags || [],
      evidence: options?.evidence,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      referenceCount: 0,
    };

    this.entries.set(entry.id, entry);
    await this.save();

    return entry;
  }

  /**
   * Record a preference
   */
  async recordPreference(
    preference: string,
    options?: { workspaceId?: string; evidence?: string }
  ): Promise<CoreMemoryEntry> {
    return this.add(preference, {
      type: 'preference',
      confidence: 0.9,
      ...options,
    });
  }

  /**
   * Record a fact
   */
  async recordFact(
    fact: string,
    options?: { workspaceId?: string; evidence?: string }
  ): Promise<CoreMemoryEntry> {
    return this.add(fact, {
      type: 'fact',
      confidence: 1.0,
      ...options,
    });
  }

  /**
   * Record a decision
   */
  async recordDecision(
    decision: string,
    rationale: string,
    options?: { workspaceId?: string }
  ): Promise<CoreMemoryEntry> {
    return this.add(decision, {
      type: 'decision',
      evidence: rationale,
      ...options,
    });
  }

  /**
   * Record a learned pattern
   */
  async recordPattern(
    pattern: string,
    options?: { workspaceId?: string; confidence?: number }
  ): Promise<CoreMemoryEntry> {
    return this.add(pattern, {
      type: 'pattern',
      confidence: options?.confidence ?? 0.7,
      ...options,
    });
  }

  /**
   * Record a skill
   */
  async recordSkill(
    skill: string,
    level?: 'beginner' | 'intermediate' | 'expert'
  ): Promise<CoreMemoryEntry> {
    const content = level ? `${skill} (${level})` : skill;
    return this.add(content, { type: 'skill' });
  }

  /**
   * Record project knowledge
   */
  async recordProjectKnowledge(
    project: string,
    knowledge: string,
    workspaceId?: string
  ): Promise<CoreMemoryEntry> {
    return this.add(`[${project}] ${knowledge}`, {
      type: 'project',
      workspaceId,
    });
  }

  /**
   * Get all entries of a type
   */
  getByType(type: CoreMemoryType): CoreMemoryEntry[] {
    return Array.from(this.entries.values()).filter(e => e.type === type);
  }

  /**
   * Get all entries
   */
  getAll(): CoreMemoryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entries for a workspace
   */
  getByWorkspace(workspaceId: string): CoreMemoryEntry[] {
    return Array.from(this.entries.values())
      .filter(e => !e.workspaceId || e.workspaceId === workspaceId);
  }

  /**
   * Search entries by content
   */
  search(query: string): CoreMemoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.entries.values())
      .filter(e => e.content.toLowerCase().includes(lowerQuery))
      .sort((a, b) => b.referenceCount - a.referenceCount);
  }

  /**
   * Get an entry by ID
   */
  get(id: string): CoreMemoryEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Update an entry
   */
  async update(id: string, updates: Partial<CoreMemoryEntry>): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
    await this.save();
    return true;
  }

  /**
   * Delete an entry
   */
  async delete(id: string): Promise<boolean> {
    const existed = this.entries.delete(id);
    if (existed) {
      await this.save();
    }
    return existed;
  }

  /**
   * Mark an entry as referenced (for tracking usage)
   */
  async markReferenced(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) {
      entry.referenceCount++;
      entry.lastReferenced = new Date().toISOString();
      // Don't save on every reference - too expensive
    }
  }

  /**
   * Get structured sections for display
   */
  getSections(): CoreMemorySection[] {
    const sections: CoreMemorySection[] = [];

    for (const [type, config] of Object.entries(SECTION_CONFIG)) {
      const entries = this.getByType(type as CoreMemoryType);
      if (entries.length > 0) {
        sections.push({
          type: type as CoreMemoryType,
          title: config.title,
          description: config.description,
          entries,
        });
      }
    }

    return sections;
  }

  /**
   * Get memory overview for display
   */
  getOverview(): string {
    const lines: string[] = [`**${this.squireName}'s Core Memory**`, ''];

    const sections = this.getSections();

    for (const section of sections) {
      lines.push(`**${section.title}:**`);
      for (const entry of section.entries.slice(0, 5)) {  // Max 5 per section
        const confidence = entry.confidence < 1 ? ` _(${Math.round(entry.confidence * 100)}%)_` : '';
        lines.push(`  - ${entry.content}${confidence}`);
      }
      if (section.entries.length > 5) {
        lines.push(`  - _...and ${section.entries.length - 5} more_`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Save to file
   */
  private async save(): Promise<void> {
    const content = this.toMarkdown();
    fs.writeFileSync(this.memoryFile, content, 'utf-8');
  }

  /**
   * Convert to Markdown
   */
  private toMarkdown(): string {
    const lines: string[] = [
      `# Memory: ${this.squireName}`,
      '',
      '> Core memory for long-term facts, preferences, and decisions.',
      '> This file is curated and should contain only important, lasting information.',
      '',
    ];

    // Write each section
    for (const [type, config] of Object.entries(SECTION_CONFIG)) {
      const entries = this.getByType(type as CoreMemoryType);

      lines.push(`## ${config.title}`, '');
      lines.push(`_${config.description}_`, '');

      if (entries.length === 0) {
        lines.push('_No entries yet_', '');
      } else {
        for (const entry of entries) {
          let line = `- ${entry.content}`;

          // Add evidence for decisions
          if (entry.evidence && type === 'decision') {
            line += `\n  Reason: ${entry.evidence}`;
          }

          // Add confidence if not 100%
          if (entry.confidence < 1) {
            line += ` _[${Math.round(entry.confidence * 100)}% confident]_`;
          }

          // Add tags
          if (entry.tags.length > 0) {
            line += ` #${entry.tags.join(' #')}`;
          }

          lines.push(line);
        }
        lines.push('');
      }
    }

    // Footer
    lines.push('---', '');
    lines.push(`_Last updated: ${new Date().toISOString()}_`);
    lines.push(`_Total entries: ${this.entries.size}_`);

    return lines.join('\n');
  }

  /**
   * Parse Markdown file
   */
  private parseMarkdown(content: string): void {
    this.entries.clear();

    const lines = content.split('\n');
    let currentType: CoreMemoryType | null = null;
    let currentContent = '';
    let currentEvidence = '';

    for (const line of lines) {
      // Check for section headers
      for (const [type, config] of Object.entries(SECTION_CONFIG)) {
        if (line === `## ${config.title}`) {
          currentType = type as CoreMemoryType;
          break;
        }
      }

      // Parse entries
      if (currentType && line.startsWith('- ')) {
        // Save previous entry
        if (currentContent) {
          this.createEntryFromLine(currentContent, currentType, currentEvidence);
          currentContent = '';
          currentEvidence = '';
        }

        currentContent = line.slice(2);
      }

      // Check for evidence line (indented)
      if (currentType && line.startsWith('  Reason:')) {
        currentEvidence = line.slice(10).trim();
      }
    }

    // Save last entry
    if (currentContent && currentType) {
      this.createEntryFromLine(currentContent, currentType, currentEvidence);
    }
  }

  /**
   * Create entry from parsed line
   */
  private createEntryFromLine(
    content: string,
    type: CoreMemoryType,
    evidence?: string
  ): void {
    // Extract confidence
    let confidence = 1.0;
    const confMatch = content.match(/_\[(\d+)% confident\]_/);
    if (confMatch) {
      confidence = parseInt(confMatch[1], 10) / 100;
      content = content.replace(/_\[\d+% confident\]_/, '').trim();
    }

    // Extract tags
    const tags: string[] = [];
    const tagMatch = content.matchAll(/#(\w+)/g);
    for (const match of tagMatch) {
      tags.push(match[1]);
      content = content.replace(`#${match[1]}`, '').trim();
    }

    const entry: CoreMemoryEntry = {
      id: uuid(),
      type,
      content,
      confidence,
      source: 'user',
      tags,
      evidence,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      referenceCount: 0,
    };

    this.entries.set(entry.id, entry);
  }

  /**
   * Get file path (for QMD indexing)
   */
  getFilePath(): string {
    return this.memoryFile;
  }
}

/**
 * Create a core memory manager
 */
export function createCoreMemoryManager(options: CoreMemoryOptions): CoreMemoryManager {
  return new CoreMemoryManager(options);
}
