import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillLoader, createSkillLoader } from './loader.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SkillLoader', () => {
  let loader: SkillLoader;
  let tempDir: string;
  let skillsDir: string;
  let bundledDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-test-'));
    skillsDir = path.join(tempDir, 'skills');
    bundledDir = path.join(tempDir, 'bundled');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(bundledDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadAll', () => {
    it('should load skills from bundled directory', async () => {
      // Create a test skill
      const skillDir = path.join(bundledDir, 'test-skill');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Test Skill
description: A test skill
---

# Test Skill

This is the content.`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      expect(skills.length).toBeGreaterThan(0);
      const testSkill = skills.find(s => s.name === 'Test Skill');
      expect(testSkill).toBeDefined();
      expect(testSkill?.description).toBe('A test skill');
    });

    it('should prioritize user skills over bundled', async () => {
      // Create bundled skill
      const bundledSkillDir = path.join(bundledDir, 'my-skill');
      fs.mkdirSync(bundledSkillDir);
      fs.writeFileSync(path.join(bundledSkillDir, 'skill.md'), `---
name: My Skill
description: Bundled version
---

Bundled content`);

      // Create user skill with same name
      const userSkillDir = path.join(skillsDir, 'my-skill');
      fs.mkdirSync(userSkillDir);
      fs.writeFileSync(path.join(userSkillDir, 'skill.md'), `---
name: My Skill
description: User version
---

User content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      const mySkill = skills.find(s => s.name === 'My Skill');
      expect(mySkill?.description).toBe('User version');
    });

    it('should handle missing directories gracefully', async () => {
      loader = createSkillLoader({
        skillsDir: path.join(tempDir, 'nonexistent'),
        bundledDir: path.join(tempDir, 'also-nonexistent'),
      });

      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it('should load skill from SKILL.md file', async () => {
      const skillDir = path.join(bundledDir, 'uppercase-skill');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: Uppercase Skill
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      expect(skills.find(s => s.name === 'Uppercase Skill')).toBeDefined();
    });

    it('should load skill from README.md file', async () => {
      const skillDir = path.join(bundledDir, 'readme-skill');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'README.md'), `---
name: Readme Skill
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      expect(skills.find(s => s.name === 'Readme Skill')).toBeDefined();
    });

    it('should skip directories without skill files', async () => {
      const noSkillDir = path.join(bundledDir, 'no-skill-here');
      fs.mkdirSync(noSkillDir);
      fs.writeFileSync(path.join(noSkillDir, 'other.txt'), 'Not a skill');

      const skillDir = path.join(bundledDir, 'has-skill');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Has Skill
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('Has Skill');
    });

    it('should use directory name as skill name if not in frontmatter', async () => {
      const skillDir = path.join(bundledDir, 'dir-name-skill');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
description: No name field
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      // extractSkillName gets the directory name from the path
      expect(skills[0].name).toBe('dir-name-skill');
    });

    it('should check eligibility for skills', async () => {
      const skillDir = path.join(bundledDir, 'eligible-test');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Eligible Test
metadata:
  squire:
    requires:
      bins:
        - node
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      // node should be available
      expect(skills[0].eligible).toBe(true);
    });

    it('should mark skill as ineligible for missing requirements', async () => {
      const skillDir = path.join(bundledDir, 'ineligible-test');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Ineligible Test
metadata:
  squire:
    requires:
      bins:
        - nonexistent-binary-xyz123
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      const skills = await loader.loadAll();

      expect(skills[0].eligible).toBe(false);
      expect(skills[0].eligibilityReason).toContain('nonexistent-binary-xyz123');
    });
  });

  describe('load', () => {
    beforeEach(() => {
      const skillDir = path.join(bundledDir, 'specific-skill');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Specific Skill
---

Content`);
    });

    it('should load a specific skill by name', async () => {
      loader = createSkillLoader({ skillsDir, bundledDir });
      const skill = await loader.load('specific-skill');

      expect(skill).not.toBeNull();
      expect(skill?.name).toBe('Specific Skill');
    });

    it('should return null for non-existent skill', async () => {
      loader = createSkillLoader({ skillsDir, bundledDir });
      const skill = await loader.load('nonexistent');

      expect(skill).toBeNull();
    });
  });

  describe('getLoaded', () => {
    it('should return all loaded skills', async () => {
      const skillDir = path.join(bundledDir, 'loaded-test');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Loaded Test
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      await loader.loadAll();

      const loaded = loader.getLoaded();
      expect(loaded.length).toBe(1);
    });
  });

  describe('get', () => {
    it('should get a loaded skill by name', async () => {
      const skillDir = path.join(bundledDir, 'get-test');
      fs.mkdirSync(skillDir);
      fs.writeFileSync(path.join(skillDir, 'skill.md'), `---
name: Get Test
---

Content`);

      loader = createSkillLoader({ skillsDir, bundledDir });
      await loader.loadAll();

      const skill = loader.get('Get Test');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('Get Test');
    });
  });

  describe('createSkillLoader factory', () => {
    it('should create loader with default paths', () => {
      const loader = createSkillLoader();
      expect(loader).toBeInstanceOf(SkillLoader);
    });
  });
});
