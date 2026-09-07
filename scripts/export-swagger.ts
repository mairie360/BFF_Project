import fs from 'node:fs';
import path from 'node:path';
import { openApiDocument } from '../src/openapi';

const serialized = JSON.stringify(openApiDocument, null, 2) + '\n';
const output = path.resolve(process.cwd(), 'contracts/openapi.json');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== serialized) {
    throw new Error('The exported BFF contract is stale. Run npm run contracts:generate.');
  }
} else {
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, serialized);
// Preserve the artifact path consumed by the OpenAPI publishing workflow.
fs.writeFileSync(path.resolve(process.cwd(), 'openapi.json'), serialized);
}
console.log(`Exported ${Object.keys(openApiDocument.paths ?? {}).length} paths to ${output}`);
