import { PropSpec } from './stacks/types';

const IGNORED_NAMES = new Set(['children', 'key', 'index', 'props']);

// Pure so it's reusable from both the VS Code extension host and the standalone CLI.
// Best-effort heuristics, not a real parser: JSON selections infer props from their
// keys/value types, anything else is scanned for `{identifier}` interpolations.
export function inferPropsFromSelection(selection: string): PropSpec[] {
  const trimmed = selection.trim();
  if (!trimmed) {
    return [];
  }

  const asJson = tryParseJson(trimmed);
  if (asJson && typeof asJson === 'object' && asJson !== null && !Array.isArray(asJson)) {
    return Object.entries(asJson as Record<string, unknown>).map(([name, value]) => ({
      name,
      type: inferTypeFromValue(value),
    }));
  }

  return inferPropsFromMarkup(trimmed);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function inferTypeFromValue(value: unknown): string {
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (Array.isArray(value)) {
    const elementType = value.length > 0 ? inferTypeFromValue(value[0]) : 'unknown';
    return `${elementType}[]`;
  }
  if (value && typeof value === 'object') {
    return 'Record<string, unknown>';
  }
  return 'unknown';
}

function inferPropsFromMarkup(markup: string): PropSpec[] {
  const matches = markup.matchAll(/\{\s*([a-zA-Z_$][\w$]*)\s*\}/g);
  const seen = new Map<string, string>();

  for (const match of matches) {
    const name = match[1];
    if (IGNORED_NAMES.has(name) || seen.has(name)) {
      continue;
    }
    const type = /^on[A-Z]/.test(name) ? '() => void' : 'string';
    seen.set(name, type);
  }

  return Array.from(seen.entries()).map(([name, type]) => ({ name, type }));
}
