import { getDb } from '../db/connection.js';
import { NotFoundError } from '../utils/errors.js';
import type { PromptVersion } from './manager.js';

interface ResolvedPrompt {
  content: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  version: number;
  promptId: string;
  promptSlug: string;
}

/**
 * Resolve a prompt reference to its published content.
 * Supports variable interpolation: {{variableName}}
 */
export function resolvePrompt(
  slugOrId: string,
  variables?: Record<string, string>,
  version?: number,
): ResolvedPrompt {
  const db = getDb();

  // Find the prompt
  const prompt = db.prepare(
    'SELECT * FROM prompts WHERE slug = ? OR id = ?'
  ).get(slugOrId, slugOrId) as Record<string, unknown> | undefined;

  if (!prompt) throw new NotFoundError(`Prompt "${slugOrId}" not found`);

  // Find the version
  let pv: Record<string, unknown> | undefined;
  if (version) {
    pv = db.prepare(
      'SELECT * FROM prompt_versions WHERE prompt_id = ? AND version = ?'
    ).get(prompt.id, version) as Record<string, unknown> | undefined;
  } else {
    // Get the published version
    pv = db.prepare(
      "SELECT * FROM prompt_versions WHERE prompt_id = ? AND tag = 'published' ORDER BY version DESC LIMIT 1"
    ).get(prompt.id) as Record<string, unknown> | undefined;
  }

  if (!pv) throw new NotFoundError(
    `No ${version ? `version ${version}` : 'published version'} found for prompt "${slugOrId}"`
  );

  // Interpolate variables
  let content = pv.content as string;
  let systemPrompt = pv.system_prompt as string | undefined;

  if (variables) {
    content = interpolateVariables(content, variables);
    if (systemPrompt) {
      systemPrompt = interpolateVariables(systemPrompt, variables);
    }
  }

  return {
    content,
    systemPrompt,
    model: pv.model as string | undefined,
    temperature: pv.temperature as number | undefined,
    maxTokens: pv.max_tokens as number | undefined,
    version: pv.version as number,
    promptId: prompt.id as string,
    promptSlug: prompt.slug as string,
  };
}

function interpolateVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
    return variables[varName] ?? match;
  });
}
