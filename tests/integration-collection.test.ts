import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// MAIR-262: the newman collection of docker-compose-integration.yml is the staging gate of this BFF. This
// guard runs with the unit tests so that a route added without its integration request, or a request that
// asserts nothing, fails here instead of silently shrinking the gate.

type Script = { listen: string; script?: { exec?: string[] } };
type Request = { method: string; url: { raw: string; host?: string[]; path?: string[] } };
type Item = { name: string; item?: Item[]; request?: Request; event?: Script[] };
type Collection = { info: { name: string }; event?: Script[]; item: Item[] };
type Environment = { values: Array<{ key: string; value: string }> };

const POSTMAN_DIR = join(__dirname, 'postman');
const collection = JSON.parse(readFileSync(join(POSTMAN_DIR, 'collection.json'), 'utf8')) as Collection;
const environment = JSON.parse(readFileSync(join(POSTMAN_DIR, 'environment.json'), 'utf8')) as Environment;
const contract = JSON.parse(readFileSync(join(__dirname, '..', 'contracts', 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

// Routes the collection calls on the BFF that are not operations of the contract (served by the app anyway).
const OUTSIDE_CONTRACT = ['GET /openapi.json', 'GET /newman/unknown-route'];

type Flat = { name: string; folder: string; request: Request; tests: string[] };

function flatten(items: Item[], folder = ''): Flat[] {
  return items.flatMap((item) => {
    if (item.item) return flatten(item.item, item.name);
    const tests = (item.event ?? []).filter((e) => e.listen === 'test').flatMap((e) => e.script?.exec ?? []);
    return [{ name: item.name, folder, request: item.request as Request, tests }];
  });
}

/** `{{baseUrl}}/projects/{{project_id}}/tasks/{{task_id}}` -> `/projects/{}/tasks/{}` (query string dropped). */
function normalize(raw: string): string {
  return raw.replace(/\?.*$/, '').replace(/^\{\{baseUrl\}\}/, '').replace(/\{\{[^}]+\}\}/g, '{}');
}

const operations = Object.entries(contract.paths).flatMap(([path, methods]) =>
  Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
);
const templates = operations.map((operation) => ({
  operation,
  regex: new RegExp(`^${operation.replace(/\{[^}]+\}/g, '{}').replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\}/g, '[^/]+')}$`),
}));
const requests = flatten(collection.item);
const onBff = requests.filter(({ request }) => request.url.raw.startsWith('{{baseUrl}}'));

function operationOf(request: Request): string | undefined {
  const key = `${request.method} ${normalize(request.url.raw)}`;
  if (OUTSIDE_CONTRACT.includes(key)) return key;
  return templates.find(({ regex }) => regex.test(key.replace(/\{\}/g, 'x')))?.operation;
}

describe('newman integration collection (MAIR-262)', () => {
  it('holds requests grouped in folders', () => {
    expect(collection.info.name).toMatch(/integration/i);
    expect(requests.length).toBeGreaterThan(0);
    for (const { folder } of requests) expect(folder).not.toBe('');
  });

  it('forges the session tokens of the seeded accounts from the JWT_SECRET of the stack', () => {
    const prerequest = (collection.event ?? []).filter((e) => e.listen === 'prerequest').flatMap((e) => e.script?.exec ?? []).join('\n');
    expect(prerequest).toContain("pm.environment.get('jwt_secret')");
    expect(prerequest).toContain("pm.environment.set('jwt_admin'");
  });

  it('commits no secret: the JWT secret and the tokens of the environment are empty', () => {
    const byKey = Object.fromEntries(environment.values.map(({ key, value }) => [key, value]));
    expect(byKey.baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
    for (const key of ['jwt_secret', 'jwt_admin', 'jwt_agent']) {
      expect(byKey[key]).toBe('');
    }
  });

  it('asserts something in every request', () => {
    const silent = requests.filter(({ tests }) => !tests.some((line) => line.includes('pm.test(')));
    expect(silent.map(({ folder, name }) => `${folder} / ${name}`)).toEqual([]);
  });

  it('only calls routes the BFF declares', () => {
    const unknown = onBff.filter(({ request }) => operationOf(request) === undefined);
    expect(unknown.map(({ request }) => `${request.method} ${request.url.raw}`)).toEqual([]);
  });

  it('covers every operation of contracts/openapi.json', () => {
    const covered = new Set(onBff.map(({ request }) => operationOf(request)));
    const uncovered = operations.filter((operation) => !covered.has(operation));
    expect(uncovered).toEqual([]);
  });
});
