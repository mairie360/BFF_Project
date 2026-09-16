import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsonSchema, OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract, resolveOrvalPackage } from './support/orval-contract';
import { agents, coreDirectory, projectBundle, projetView, sessionResponse, taskView } from './support/project-fixtures';

// Les contrats amont sont reconstruits depuis les paquets @mairie360/*-openapi installés : monter la version
// dans package.json suffit à tester le BFF contre le nouveau contrat.

const PACKAGES = [
  { name: '@mairie360/project-api-openapi', section: 'dependencies' },
  { name: '@mairie360/core-api-openapi', section: 'dependencies' },
  // Aligné sur l'image ghcr.io/mairie360/bff-user des stacks de test (docker-compose-*.yml).
  { name: '@mairie360/bff-user-openapi', section: 'devDependencies' },
] as const;

// Opérations amont réellement appelées (src/clients/{projectClient,coreDirectory,userBffClient}.ts,
// src/services/projectData.ts, project_helpers.ts, auth/project-user.ts, routes/check_apis.ts).
// Le BFF n'a plus d'accès direct à PostgreSQL : tout passe par ces opérations.
const CONSUMED = [
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProjects', method: 'get', template: '/api/v1/projects/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'createProject', method: 'post', template: '/api/v1/projects/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProject', method: 'get', template: '/api/v1/projects/{projectId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'updateProject', method: 'patch', template: '/api/v1/projects/{projectId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'closeProject', method: 'patch', template: '/api/v1/projects/{projectId}/close' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'deleteProject', method: 'delete', template: '/api/v1/projects/{projectId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProjectTasks', method: 'get', template: '/api/v1/projects/{projectId}/tasks/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'createTask', method: 'post', template: '/api/v1/projects/{projectId}/tasks/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'deleteTask', method: 'delete', template: '/api/v1/projects/{projectId}/tasks/{taskId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'patchTask', method: 'patch', template: '/api/v1/projects/{projectId}/tasks/{taskId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'getTaskCollaboration', method: 'get', template: '/api/v1/projects/{projectId}/tasks/{taskId}/collaboration' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'addTaskComment', method: 'post', template: '/api/v1/projects/{projectId}/tasks/{taskId}/comments' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'appendTaskHistory', method: 'post', template: '/api/v1/projects/{projectId}/tasks/{taskId}/history' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'getProjectUsers', method: 'get', template: '/api/v1/projects/{projectId}/users/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'addUserToProject', method: 'post', template: '/api/v1/projects/{projectId}/users/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'removeUserFromProject', method: 'delete', template: '/api/v1/projects/{projectId}/users/{userId}/' },
  { pkg: '@mairie360/project-api-openapi', operationId: 'health', method: 'get', template: '/health' },
  { pkg: '@mairie360/core-api-openapi', operationId: 'listDirectoryUsers', method: 'get', template: '/api/v1/user/' },
  { pkg: '@mairie360/core-api-openapi', operationId: 'health', method: 'get', template: '/health' },
  { pkg: '@mairie360/bff-user-openapi', operationId: 'getMe', method: 'get', template: '/me' },
] as const;

const projectApi = loadOrvalContract('@mairie360/project-api-openapi');
const coreApi = loadOrvalContract('@mairie360/core-api-openapi');
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

  test('Project API 0.5.0 publishes everything the BFF used to read from PostgreSQL', () => {
    // Lecture d'un projet, modification d'une tâche, commentaires et historique : plus aucune requête SQL côté BFF.
    const bundle = projectApi.match('GET', '/api/v1/projects/1/')!;
    expect(projectApi.schema('GetProjectResultView')).toMatchObject({ required: ['project', 'tasks', 'users'] });
    expect(projectApi.responseSchema(bundle, 200).schema).toEqual({ $ref: '#/components/schemas/GetProjectResultView' });
    expect(projectApi.requestBodySchema(projectApi.match('PATCH', '/api/v1/projects/1/tasks/2/')!))
      .toEqual({ required: true, schema: { $ref: '#/components/schemas/PatchTaskView' } });
    expect(projectApi.schema('TaskCollaborationView')).toMatchObject({ required: ['comments', 'history'] });
  });
});

describe('fixtures conform to the upstream contracts', () => {
  test.each([
    ['Project API GET /api/v1/projects/ 200', projectApi, 'get', '/api/v1/projects/', { projects: [projetView(1), projetView(2, { status: 'Suspended' })] }],
    ['Project API POST /api/v1/projects/ 200', projectApi, 'post', '/api/v1/projects/', { project_id: 12 }],
    ['Project API GET /api/v1/projects/{projectId}/tasks/ 200', projectApi, 'get', '/api/v1/projects/1/tasks/', { tasks: [taskView(1), taskView(2, { assigned_to: 2, status: 'Completed', priority: 'Urgent' })] }],
    ['Project API POST /api/v1/projects/{projectId}/tasks/ 200', projectApi, 'post', '/api/v1/projects/1/tasks/', { task_id: 7, name: 'Tâche 7', description: null }],
    ['Project API GET /api/v1/projects/{projectId}/users/ 200', projectApi, 'get', '/api/v1/projects/1/users/', { users: [{ id: 1 }, { id: 2 }] }],
    ['Project API GET /api/v1/projects/{projectId}/ 200', projectApi, 'get', '/api/v1/projects/1/', projectBundle(projetView(1), [taskView(1)], [agents.alice])],
    ['Core API GET /api/v1/user/ 200', coreApi, 'get', '/api/v1/user/', coreDirectory([agents.admin, agents.alice])],
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
      expect.stringContaining('$.tasks[0].due_date: type string|null attendu'),
    ]));
  });

  test('validates path parameters and request bodies of the Project API', () => {
    expect(projectApi.validateRequest('DELETE', new URL('http://api/api/v1/projects/abc/')).errors)
      .toEqual([expect.stringContaining('path.projectId: type number attendu')]);
    expect(projectApi.validateRequest('PUT', new URL('http://api/api/v1/projects/1/')).errors)
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
