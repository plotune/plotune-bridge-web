import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(join(process.cwd(), 'contract/schema/bridge-can-contract.v0.1.0.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const root = ajv.compile(schema);

/** Validates wire JSON text against the contract schema. Numbers are parsed lossily here, which the schema does not mind. */
export function schemaErrors(text: string): string[] {
  const value = JSON.parse(text);
  return root(value) ? [] : (root.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

export function assertSchemaValid(text: string): void {
  const errors = schemaErrors(text);
  if (errors.length) throw new Error(`schema violation: ${errors.join('; ')}\n${text}`);
}

export const contractVersion: string = schema['x-contract-version'];
