import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsonSchema, OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract, resolveOrvalPackage } from './support/orval-contract';
import { agents, projetView, sessionResponse, taskView } from './support/project-fixtures';

// Les contrats amont sont reconstruits depuis les paquets @mairie360/*-openapi installés : monter la version
// dans package.json suffit à tester le BFF contre le nouveau contrat.

const PACKAGES = [
  { name: '@mairie360/project-api-openapi', section: 'dependencies' },
  { name: '@mairie360/core-api-openapi', section: 'dependencies' },
  // Aligné sur l'image ghcr.io/mairie360/bff-user des stacks de test (docker-compose-*.yml).
  { name: '@mairie360/bff-user-openapi', section: 'devDependencies' },
] as const;

// Opérations amont réellement appelées (src/clients/projectClient.ts, project_helpers.ts, auth/project-user.ts,
// routes/check_apis.ts).
const CONSUMED = [
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProjects', method: 'get', template: '/api/v1/projects/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'createProject', method: 'post', template: '/api/v1/projects/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'deleteProject', method: 'delete', template: '/api/v1/projects/{projectId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProjectTasks', method: 'get', template: '/api/v1/projects/{projectId}/tasks/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'createTask', method: 'post', template: '/api/v1/projects/{projectId}/tasks/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'deleteTask', method: 'delete', template: '/api/v1/projects/{projectId}/tasks/{taskId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProjectUsers', method: 'get', template: '/api/v1/projects/{projectId}/users/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'addUserToProject', method: 'post', template: '/api/v1/projects/{projectId}/users/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'removeUserFromProject', method: 'delete', template: '/api/v1/projects/{projectId}/users/{userId}//' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'health', method: 'get', template: '/health' },
  { pkg: '@mairie360/core-api-openapi', operationId: 'health', method: 'get', template: '/health' },
  { pkg: '@mairie360/bff-user-openapi', operationId: 'getMe', method: 'get', template: '/me' },
] as const;

const projectApi = loadOrvalContract('@mairie360/project-api-openapi');
const userBff = loadOrvalContract('@mairie360/bff-user-openapi');

function responseSchema(contract: OpenApiContract, method: string, pathname: string, status: number): JsonSchema {
  const match = contract.match(method, pathname);
  if (!match) throw new Error(`${method} ${pathname} absent de ${contract.title}`);
  const { schema } = contract.responseSchema(match, status);
  if (!schema) throw new Error(`Pas de schéma JSON pour ${status} ${method} ${pathname}`);
  return schema;
}

describe('upstream contracts from the installed @mairie360 OpenAPI packages', () => {
  test.each(PACKAGES)('$name is the version pinned in package.json', ({ name, section }) => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as Record<typeof section, Record<string, string>>;
    expect(resolveOrvalPackage(name).version).toBe(pkg[section][name]);
  });

  test.each(CONSUMED)('$pkg declares $operationId as $method $template', ({ pkg, operationId, method, template }) => {
    const operation = loadOrvalContract(pkg).document.paths[template]?.[method] as { operationId?: string } | undefined;
    expect(operation?.operationId).toBe(operationId);
  });

  test('keeps request bodies, path parameters and enums of the Project API operations', () => {
    const createTask = projectApi.match('POST', '/api/v1/projects/4/tasks/')!;
    expect(createTask.operation.parameters).toEqual([{ name: 'projectId', in: 'path', required: true, schema: { type: 'number' } }]);
    expect(projectApi.requestBodySchema(createTask)).toEqual({ required: true, schema: { $ref: '#/components/schemas/CreateTaskView' } });
    expect(projectApi.schema('CreateTaskView')).toMatchObject({ required: ['fields', 'name'] });
    expect(projectApi.schema('TaskStatus')).toEqual({ type: 'string', enum: ['Todo', 'InProgress', 'Completed', 'Error'] });
    expect(projectApi.schema('TaskPriority')).toEqual({ type: 'string', enum: ['Low', 'Medium', 'High', 'Urgent', 'Error'] });
    expect(projectApi.schema('FieldType')).toEqual({ type: 'string', enum: ['date', 'checkbox', 'select', 'unknown'] });
    expect(projectApi.responseSchema(projectApi.match('DELETE', '/api/v1/projects/4/')!, 204)).toEqual({ documented: true, schema: undefined });
    // Les erreurs ne sont pas typées par orval : aucun statut hors 2XX n'est documenté.
    expect(projectApi.responseSchema(projectApi.match('GET', '/api/v1/projects/')!, 500).documented).toBe(false);
  });

  test('Project API 0.4.1 no longer publishes GET project nor PATCH task', () => {
    // Les routes du BFF qui en dépendent répondent 501 quand PROJECT_DB_ACCESS=disabled (project_helpers.ts).
    expect(projectApi.document.paths['/api/v1/projects/{projectId}/']).not.toHaveProperty('get');
    expect(projectApi.document.paths['/api/v1/projects/{projectId}/tasks/{taskId}/']).not.toHaveProperty('patch');
  });
});

describe('fixtures conform to the upstream contracts', () => {
  test.each([
    ['Project API GET /api/v1/projects/ 200', projectApi, 'get', '/api/v1/projects/', { projects: [projetView(1), projetView(2, { status: 'Suspended' })] }],
    ['Project API POST /api/v1/projects/ 200', projectApi, 'post', '/api/v1/projects/', { project_id: 12 }],
    ['Project API GET /api/v1/projects/{projectId}/tasks/ 200', projectApi, 'get', '/api/v1/projects/1/tasks/', { tasks: [taskView(1), taskView(2, { assigned_to: 2, status: 'Completed', priority: 'Urgent' })] }],
    ['Project API POST /api/v1/projects/{projectId}/tasks/ 200', projectApi, 'post', '/api/v1/projects/1/tasks/', { task_id: 7, name: 'Tâche 7', description: null }],
    ['Project API GET /api/v1/projects/{projectId}/users/ 200', projectApi, 'get', '/api/v1/projects/1/users/', { users: [{ id: 1 }, { id: 2 }] }],
    ['BFF User GET /me 200', userBff, 'get', '/me', sessionResponse(agents.alice)],
  ] as const)('%s', (_name, contract, method, pathname, body) => {
    expect(contract.validate(responseSchema(contract, method, pathname, 200), body)).toEqual([]);
  });
});

describe('contract validator', () => {
  test('reports missing required properties, wrong enums, wrong types and minimum', () => {
    const invalid = { ...taskView(1), id: -1, status: 'Done', due_date: 20261001 } as Record<string, unknown>;
    delete invalid.title;
    expect(projectApi.validate(responseSchema(projectApi, 'get', '/api/v1/projects/1/tasks/', 200), { tasks: [invalid] })).toEqual(expect.arrayContaining([
      expect.stringContaining('$.tasks[0].title: propriété requise manquante'),
      expect.stringContaining('$.tasks[0].id: -1 < minimum 0'),
      expect.stringContaining('$.tasks[0].status: valeur "Done" hors enum'),
      expect.stringContaining('$.tasks[0].due_date: type string attendu'),
    ]));
  });

  test('validates path parameters and request bodies of the Project API', () => {
    expect(projectApi.validateRequest('DELETE', new URL('http://api/api/v1/projects/abc/')).errors)
      .toEqual([expect.stringContaining('path.projectId: type number attendu')]);
    expect(projectApi.validateRequest('GET', new URL('http://api/api/v1/projects/1/')).errors)
      .toEqual([expect.stringContaining("n'existe pas dans le contrat project_api")]);
    const createTask = projectApi.match('POST', '/api/v1/projects/1/tasks/')!;
    expect(projectApi.validate(projectApi.requestBodySchema(createTask).schema!, { name: 'Sans champs', status: 'Doing' }))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('$.fields: propriété requise manquante'),
        expect.stringContaining('$.status: aucune alternative anyOf'),
      ]));
  });

  test('resolves BFF User session unions', () => {
    const body = { ...sessionResponse(agents.alice), roles: ['User', { id: 3 }] };
    expect(userBff.validate(responseSchema(userBff, 'get', '/me', 200), body))
      .toEqual([expect.stringContaining('$.roles[1]: aucune alternative anyOf')]);
  });
});
