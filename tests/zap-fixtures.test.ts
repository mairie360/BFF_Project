import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ZAP fills path parameters with the contract examples (docker-compose-security.yml). The 200 of
// PATCH /projects/{projectId}/statuses/{statusId} lists every status of the project with its task
// count: in a project whose tasks other scanned operations create, delete or move, two probes of the
// PATCH got different bodies depending on timing, and ZAP read the difference as an injection
// (Path Traversal, SQL Injection, MAIR-566).

type Parameter = { name: string; in: string; example?: unknown; schema?: { example?: unknown } };
type Operation = { parameters?: Parameter[] };

const contract = JSON.parse(readFileSync(join(__dirname, '../contracts/openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
};
const seed = readFileSync(join(__dirname, '../init-test.sql'), 'utf8');

const WRITES = new Set(['post', 'put', 'patch', 'delete']);
const STATUS_UPDATE = '/projects/{projectId}/statuses/{statusId}';

function pathExample(operation: Operation, name: string): unknown {
  const parameter = operation.parameters?.find((p) => p.in === 'path' && p.name === name);
  return parameter?.example ?? parameter?.schema?.example;
}

describe('ZAP fixture of PATCH /projects/{projectId}/statuses/{statusId}', () => {
  const statusUpdate = contract.paths[STATUS_UPDATE].patch;
  const projectId = pathExample(statusUpdate, 'projectId');

  it('targets a project no other scanned write operation names', () => {
    const others = Object.entries(contract.paths).flatMap(([path, operations]) =>
      Object.entries(operations)
        .filter(([method]) => WRITES.has(method) && !(path === STATUS_UPDATE && method === 'patch'))
        .filter(([, operation]) => pathExample(operation, 'projectId') === projectId)
        .map(([method]) => `${method.toUpperCase()} ${path}`));

    expect(projectId).toBe('project-4');
    expect(others).toEqual([]);
  });

  it('targets a project init-test.sql seeds', () => {
    const id = String(projectId).replace('project-', '');
    expect(seed).toMatch(new RegExp(`\\(${id}, 'Scan renamed statuses project'`));
  });
});
