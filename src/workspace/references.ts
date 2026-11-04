import { fingerprint, type DatabaseReference } from '../dbc/references';
import { safeFileName, type DbcRegistry } from '../dbc/registry';
import type { ProjectStore } from './project';

export async function exportWorkspace(store: ProjectStore, registry: DbcRegistry): Promise<string> {
  // Snapshot both configuration and bindings before asynchronous hashing.
  const project = structuredClone(store.getState().project);
  const loaded = await registry.references();
  const refs = new Map((project.databaseReferences ?? []).map((r) => [`${r.source}\0${r.channel}`, r]));
  for (const r of loaded) {
    const key = `${r.source}\0${r.channel}`;
    // An unrelated local binding must not rewrite an imported file identity.
    if (!refs.has(key)) refs.set(key, r);
  }
  if (refs.size > 64) throw new Error('This workspace has more than 64 database references. Remove unused bindings before exporting.');
  return JSON.stringify({ ...project, databaseReferences: [...refs.values()] }, null, 1);
}

export function importWorkspace(store: ProjectStore, json: string): ReturnType<ProjectStore['importJson']> {
  return store.importJson(json);
}

export async function relinkDatabase(registry: DbcRegistry, ref: DatabaseReference, name: string, text: string) {
  if (safeFileName(name) !== ref.fileName || await fingerprint(text) !== ref.sha256) {
    return { ok: false as const, message: `Choose ${ref.fileName} with the matching contents. This file does not match the workspace reference.` };
  }
  const result = registry.assign(ref.source, ref.channel, name, text);
  await registry.recheckReferences();
  return result;
}
