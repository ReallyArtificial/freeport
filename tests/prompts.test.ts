import { describe, it, expect } from 'vitest';
import {
  createPrompt,
  getPrompt,
  listPrompts,
  updatePrompt,
  deletePrompt,
  createVersion,
  listVersions,
  getVersion,
  tagVersion,
} from '../src/prompts/manager.js';
import { resolvePrompt } from '../src/prompts/resolver.js';

describe('Prompt Manager', () => {
  it('creates and retrieves a prompt', () => {
    const prompt = createPrompt({ slug: 'test-prompt', name: 'Test Prompt', description: 'A test' });

    expect(prompt.slug).toBe('test-prompt');
    expect(prompt.name).toBe('Test Prompt');
    expect(prompt.id).toBeDefined();

    const fetched = getPrompt('test-prompt');
    expect(fetched.id).toBe(prompt.id);
  });

  it('prevents duplicate slugs', () => {
    createPrompt({ slug: 'unique-slug', name: 'First' });
    expect(() => createPrompt({ slug: 'unique-slug', name: 'Second' })).toThrow('already exists');
  });

  it('lists prompts', () => {
    createPrompt({ slug: 'a', name: 'A' });
    createPrompt({ slug: 'b', name: 'B' });

    const all = listPrompts();
    expect(all).toHaveLength(2);
  });

  it('updates a prompt', () => {
    const p = createPrompt({ slug: 'update-me', name: 'Old Name' });
    const updated = updatePrompt(p.id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
  });

  it('throws ValidationError when no fields to update', () => {
    const p = createPrompt({ slug: 'no-update', name: 'Name' });
    expect(() => updatePrompt(p.id, {})).toThrow('No fields to update');
  });

  it('deletes a prompt', () => {
    const p = createPrompt({ slug: 'delete-me', name: 'Delete Me' });
    deletePrompt(p.id);
    expect(() => getPrompt(p.id)).toThrow('not found');
  });

  it('throws NotFoundError for missing prompt', () => {
    expect(() => getPrompt('nonexistent')).toThrow('not found');
  });
});

describe('Prompt Versions', () => {
  it('creates versions with auto-incrementing numbers', () => {
    const p = createPrompt({ slug: 'versioned', name: 'Versioned' });
    const v1 = createVersion(p.id, { content: 'Version 1' });
    const v2 = createVersion(p.id, { content: 'Version 2' });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.tag).toBe('draft');
  });

  it('lists versions in descending order', () => {
    const p = createPrompt({ slug: 'list-v', name: 'List Versions' });
    createVersion(p.id, { content: 'V1' });
    createVersion(p.id, { content: 'V2' });
    createVersion(p.id, { content: 'V3' });

    const versions = listVersions(p.id);
    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe(3);
    expect(versions[2].version).toBe(1);
  });

  it('gets a specific version', () => {
    const p = createPrompt({ slug: 'get-v', name: 'Get Version' });
    createVersion(p.id, { content: 'Content 1' });
    createVersion(p.id, { content: 'Content 2' });

    const v = getVersion(p.id, 2);
    expect(v.content).toBe('Content 2');
  });

  it('publishes a version and archives the previous', () => {
    const p = createPrompt({ slug: 'publish', name: 'Publish Test' });
    const v1 = createVersion(p.id, { content: 'First', tag: 'published' });
    const v2 = createVersion(p.id, { content: 'Second' });

    // Publish v2 — should archive v1
    tagVersion(v2.id, 'published');

    const versions = listVersions(p.id);
    const published = versions.filter(v => v.tag === 'published');
    const archived = versions.filter(v => v.tag === 'archived');
    expect(published).toHaveLength(1);
    expect(published[0].version).toBe(2);
    expect(archived).toHaveLength(1);
    expect(archived[0].version).toBe(1);
  });

  it('stores model and temperature overrides', () => {
    const p = createPrompt({ slug: 'overrides', name: 'Overrides' });
    const v = createVersion(p.id, {
      content: 'Test',
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 1000,
      systemPrompt: 'You are helpful.',
      variables: ['name', 'topic'],
    });

    expect(v.model).toBe('gpt-4o');
    expect(v.temperature).toBe(0.5);
    expect(v.maxTokens).toBe(1000);
    expect(v.systemPrompt).toBe('You are helpful.');
    expect(v.variables).toEqual(['name', 'topic']);
  });
});

describe('Prompt Resolver', () => {
  it('resolves a published prompt by slug', () => {
    const p = createPrompt({ slug: 'resolve-me', name: 'Resolve Me' });
    const v = createVersion(p.id, { content: 'Hello {{name}}!', tag: 'published' });

    const resolved = resolvePrompt('resolve-me', { name: 'World' });
    expect(resolved.content).toBe('Hello World!');
    expect(resolved.version).toBe(1);
  });

  it('resolves a specific version', () => {
    const p = createPrompt({ slug: 'specific-v', name: 'Specific Version' });
    createVersion(p.id, { content: 'V1 content', tag: 'published' });
    createVersion(p.id, { content: 'V2 content' });

    const resolved = resolvePrompt('specific-v', undefined, 2);
    expect(resolved.content).toBe('V2 content');
  });

  it('throws when no published version exists', () => {
    const p = createPrompt({ slug: 'draft-only', name: 'Draft Only' });
    createVersion(p.id, { content: 'Still a draft' });

    expect(() => resolvePrompt('draft-only')).toThrow('No published version');
  });

  it('interpolates multiple variables', () => {
    const p = createPrompt({ slug: 'multi-var', name: 'Multi Var' });
    createVersion(p.id, {
      content: 'Hi {{name}}, your topic is {{topic}}.',
      systemPrompt: 'Assistant for {{name}}.',
      tag: 'published',
    });

    const resolved = resolvePrompt('multi-var', { name: 'Alice', topic: 'AI' });
    expect(resolved.content).toBe('Hi Alice, your topic is AI.');
    expect(resolved.systemPrompt).toBe('Assistant for Alice.');
  });

  it('leaves unknown variables as-is', () => {
    const p = createPrompt({ slug: 'unknown-var', name: 'Unknown Var' });
    createVersion(p.id, { content: 'Hello {{unknown}}!', tag: 'published' });

    const resolved = resolvePrompt('unknown-var', {});
    expect(resolved.content).toBe('Hello {{unknown}}!');
  });
});
