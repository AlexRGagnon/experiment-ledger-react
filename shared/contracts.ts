export interface RunInput {
  name: string;
  model: string;
  dataset: string;
  seed: number;
  metrics: Record<string, number>;
}
export interface Run extends RunInput {
  id: string;
  digest: string;
  notes: string;
  version: number;
  createdAt: string;
}
export class Problem extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'Problem';
    this.status = status;
  }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Problem('Expected a JSON object.');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((k) => !Object.hasOwn(result, k)))
    throw new Problem('Fields do not match the expected schema.');
  return result;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Problem(`${label} must contain 1..${max} characters.`);
  return value.trim();
}
export function parseRun(value: unknown): RunInput {
  const v = object(value, ['name', 'model', 'dataset', 'seed', 'metrics']);
  if (
    typeof v.seed !== 'number' ||
    !Number.isSafeInteger(v.seed) ||
    v.seed < 0 ||
    v.seed > 2147483647
  )
    throw new Problem('Seed must be an integer between 0 and 2147483647.');
  if (!v.metrics || typeof v.metrics !== 'object' || Array.isArray(v.metrics))
    throw new Problem('Metrics must be an object.');
  const entries = Object.entries(v.metrics);
  if (entries.length < 1 || entries.length > 30)
    throw new Problem('Include between 1 and 30 metrics.');
  const metrics: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [key, val] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!/^[A-Za-z][A-Za-z0-9_. -]{0,39}$/.test(key) || ['constructor', 'prototype'].includes(key))
      throw new Problem('Invalid metric name.');
    if (typeof val !== 'number' || !Number.isFinite(val) || Math.abs(val) > 1e12)
      throw new Problem('Metric values must be finite numbers with magnitude <= 1e12.');
    metrics[key] = val;
  }
  return {
    name: text(v.name, 'Name', 120),
    model: text(v.model, 'Model', 120),
    dataset: text(v.dataset, 'Dataset', 120),
    seed: v.seed,
    metrics,
  };
}
export function parseNotes(value: unknown): { notes: string; version: number } {
  const v = object(value, ['notes', 'version']);
  if (typeof v.notes !== 'string' || v.notes.length > 4000)
    throw new Problem('Notes must be at most 4000 characters.');
  if (typeof v.version !== 'number' || !Number.isSafeInteger(v.version) || v.version < 1)
    throw new Problem('Invalid note version.');
  return { notes: v.notes, version: v.version };
}
