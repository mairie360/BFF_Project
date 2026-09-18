import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsonSchema, OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract, resolveOrvalPackage } from './support/orval-contract';
import {
  agents, coreApiUrls, coreDirectory, createProjectResult, createTaskResult, projectApiUrls, projectBundle, projectUsersResult, projectsResult,
  projetView, sessionResponse, taskView, userBffUrls,
} from './support/project-fixtures';

// Les contrats amont sont reconstruits depuis les paquets @mairie360/*-openapi installés : monter la version
// dans package.json suffit à tester le BFF contre le nouveau contrat.

const PACKAGES = [
  { name: '@mairie360/project-api-openapi', section: 'dependencies' },
  { name: '@mairie360/core-api-openapi', section: 'dependencies' },
  // Aligné sur l'image ghcr.io/mairie360/bff-user des stacks de test (docker-compose-*.yml).
  { name: '@mairie360/bff-user-openapi', section: 'devDependencies' },
] as const;

const projectApi = loadOrvalContract('@mairie360/project-api-openapi');
const coreApi = loadOrvalContract('@mairie360/core-api-openapi');
const userBff = loadOrvalContract('@mairie360/bff-user-openapi');

/** Chemin d'une opération tel que le client généré le construit (helper `get*Url`), sans sa query string. */
const pathname = (url: string) => new URL(url, 'http://upstream').pathname;

// Opérations amont réellement appelées (src/clients/{projectClient,coreDirectory,userBffClient}.ts,
// src/services/projectData.ts, project_helpers.ts, auth/project-user.ts, routes/check_apis.ts), adressées par les
// helpers d'URL des clients générés. Le BFF n'a plus d'accès direct à PostgreSQL : tout passe par ces opérations.
const CONSUMED = [
  { contract: projectApi, operationId: 'getProjects', method: 'get', url: projectApiUrls.getGetProjectsUrl() },
  { contract: projectApi, operationId: 'createProject', method: 'post', url: projectApiUrls.getCreateProjectUrl() },
  { contract: projectApi, operationId: 'getProject', method: 'get', url: projectApiUrls.getGetProjectUrl(4) },
  { contract: projectApi, operationId: 'updateProject', method: 'patch', url: projectApiUrls.getUpdateProjectUrl(4) },
  { contract: projectApi, operationId: 'closeProject', method: 'patch', url: projectApiUrls.getCloseProjectUrl(4) },
  { contract: projectApi, operationId: 'deleteProject', method: 'delete', url: projectApiUrls.getDeleteProjectUrl(4) },
  { contract: projectApi, operationId: 'getProjectTasks', method: 'get', url: projectApiUrls.getGetProjectTasksUrl(4) },
  { contract: projectApi, operationId: 'createTask', method: 'post', url: projectApiUrls.getCreateTaskUrl(4) },
  { contract: projectApi, operationId: 'deleteTask', method: 'delete', url: projectApiUrls.getDeleteTaskUrl(4, 2) },
  { contract: projectApi, operationId: 'patchTask', method: 'patch', url: projectApiUrls.getPatchTaskUrl(4, 2) },
  { contract: projectApi, operationId: 'getTaskCollaboration', method: 'get', url: projectApiUrls.getGetTaskCollaborationUrl(4, 2) },
  { contract: projectApi, operationId: 'addTaskComment', method: 'post', url: projectApiUrls.getAddTaskCommentUrl(4, 2) },
  { contract: projectApi, operationId: 'appendTaskHistory', method: 'post', url: projectApiUrls.getAppendTaskHistoryUrl(4, 2) },
  { contract: projectApi, operationId: 'getProjectUsers', method: 'get', url: projectApiUrls.getGetProjectUsersUrl(4) },
  { contract: projectApi, operationId: 'addUserToProject', method: 'post', url: projectApiUrls.getAddUserToProjectUrl(4) },
  { contract: projectApi, operationId: 'removeUserFromProject', method: 'delete', url: projectApiUrls.getRemoveUserFromProjectUrl(4, 2) },
  { contract: projectApi, operationId: 'health', method: 'get', url: projectApiUrls.getHealthUrl() },
  { contract: coreApi, operationId: 'listDirectoryUsers', method: 'get', url: coreApiUrls.getListDirectoryUsersUrl({ group_ids: '1' }) },
  { contract: coreApi, operationId: 'health', method: 'get', url: coreApiUrls.getHealthUrl() },
  { contract: userBff, operationId: 'getMe', method: 'get', url: userBffUrls.getGetMeUrl() },
] as const;

function responseSchema(contract: OpenApiContract, method: string, url: string, status: number): JsonSchema {
  const match = contract.match(method, pathname(url));
  if (!match) throw new Error(`${method} ${url} absent de ${contract.title}`);
  const { schema } = contract.responseSchema(match, status);
  if (!schema) throw new Error(`Pas de schéma JSON pour ${status} ${method} ${url}`);
  return schema;
}

describe('upstream contracts from the installed @mairie360 OpenAPI packages', () => {
  test.each(PACKAGES)('$name is the version pinned in package.json', ({ name, section }) => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as Record<typeof section, Record<string, string>>;
    expect(resolveOrvalPackage(name).version).toBe(pkg[section][name]);
  });

  test.each(CONSUMED)('$contract.title routes $method $url to $operationId', ({ contract, operationId, method, url }) => {
    const { match, errors } = contract.validateRequest(method, new URL(url, 'http://upstream'));
    expect(errors).toEqual([]);
    expect((match?.operation as { operationId?: string } | undefined)?.operationId).toBe(operationId);
  });

  test('keeps request bodies, path parameters and enums of the Project API operations', () => {
    const createTask = projectApi.match('POST', projectApiUrls.getCreateTaskUrl(4))!;
    expect(createTask.operation.parameters).toEqual([{ name: 'projectId', in: 'path', required: true, schema: { type: 'number' } }]);
    expect(projectApi.requestBodySchema(createTask)).toEqual({ required: true, schema: { $ref: '#/components/schemas/CreateTaskView' } });
    expect(projectApi.schema('CreateTaskView')).toMatchObject({ required: ['fields', 'name'] });
    expect(projectApi.schema('TaskStatus')).toEqual({ type: 'string', enum: ['Todo', 'InProgress', 'Completed', 'Error'] });
    expect(projectApi.schema('TaskPriority')).toEqual({ type: 'string', enum: ['Low', 'Medium', 'High', 'Urgent', 'Error'] });
    expect(projectApi.schema('FieldType')).toEqual({ type: 'string', enum: ['date', 'checkbox', 'select', 'unknown'] });
    expect(projectApi.responseSchema(projectApi.match('DELETE', projectApiUrls.getDeleteProjectUrl(4))!, 204)).toEqual({ documented: true, schema: undefined });
    // Les erreurs ne sont pas typées par orval : aucun statut hors 2XX n'est documenté.
    expect(projectApi.responseSchema(projectApi.match('GET', projectApiUrls.getGetProjectsUrl())!, 500).documented).toBe(false);
  });

  test('Project API publishes everything the BFF used to read from PostgreSQL', () => {
    // Lecture d'un projet, modification d'une tâche, commentaires et historique : plus aucune requête SQL côté BFF.
    const bundle = projectApi.match('GET', projectApiUrls.getGetProjectUrl(1))!;
    expect(projectApi.schema('GetProjectResultView')).toMatchObject({ required: ['project', 'tasks', 'users'] });
    expect(projectApi.responseSchema(bundle, 200).schema).toEqual({ $ref: '#/components/schemas/GetProjectResultView' });
    expect(projectApi.requestBodySchema(projectApi.match('PATCH', projectApiUrls.getPatchTaskUrl(1, 2))!))
      .toEqual({ required: true, schema: { $ref: '#/components/schemas/PatchTaskView' } });
    expect(projectApi.schema('TaskCollaborationView')).toMatchObject({ required: ['comments', 'history'] });
  });
});

describe('fixtures conform to the upstream contracts', () => {
  test.each([
    ['Project API getProjects 200', projectApi, 'get', projectApiUrls.getGetProjectsUrl(), projectsResult([projetView(1), projetView(2, { status: 'Suspended' })])],
    ['Project API createProject 200', projectApi, 'post', projectApiUrls.getCreateProjectUrl(), createProjectResult(12)],
    ['Project API getProjectTasks 200', projectApi, 'get', projectApiUrls.getGetProjectTasksUrl(1), { tasks: [taskView(1), taskView(2, { assigned_to: 2, status: 'Completed', priority: 'Urgent' })] }],
    ['Project API createTask 200', projectApi, 'post', projectApiUrls.getCreateTaskUrl(1), createTaskResult(7, 'Tâche 7')],
    ['Project API getProjectUsers 200', projectApi, 'get', projectApiUrls.getGetProjectUsersUrl(1), projectUsersResult([{ id: 1 }, { id: 2 }])],
    ['Project API getProject 200', projectApi, 'get', projectApiUrls.getGetProjectUrl(1), projectBundle(projetView(1), [taskView(1)], [agents.alice])],
    ['Core API listDirectoryUsers 200', coreApi, 'get', coreApiUrls.getListDirectoryUsersUrl(), coreDirectory([agents.admin, agents.alice])],
    ['BFF User getMe 200', userBff, 'get', userBffUrls.getGetMeUrl(), sessionResponse(agents.alice)],
  ] as const)('%s', (_name, contract, method, url, body) => {
    expect(contract.validate(responseSchema(contract, method, url, 200), body)).toEqual([]);
  });
});

describe('contract validator', () => {
  test('reports missing required properties, wrong enums, wrong types and minimum', () => {
    const invalid = { ...taskView(1), id: -1, status: 'Done', due_date: 20261001 } as Record<string, unknown>;
    delete invalid.title;
    expect(projectApi.validate(responseSchema(projectApi, 'get', projectApiUrls.getGetProjectTasksUrl(1), 200), { tasks: [invalid] })).toEqual(expect.arrayContaining([
      expect.stringContaining('$.tasks[0].title: propriété requise manquante'),
      expect.stringContaining('$.tasks[0].id: -1 < minimum 0'),
      expect.stringContaining('$.tasks[0].status: valeur "Done" hors enum'),
      expect.stringContaining('$.tasks[0].due_date: type string|null attendu'),
    ]));
  });

  test('validates path parameters and request bodies of the Project API', () => {
    expect(projectApi.validateRequest('DELETE', new URL('http://api/api/v1/projects/abc/')).errors)
      .toEqual([expect.stringContaining('path.projectId: type number attendu')]);
    expect(projectApi.validateRequest('PUT', new URL(projectApiUrls.getGetProjectUrl(1), 'http://api')).errors)
      .toEqual([expect.stringContaining(`n'existe pas dans le contrat ${projectApi.title}`)]);
    const createTask = projectApi.match('POST', projectApiUrls.getCreateTaskUrl(1))!;
    expect(projectApi.validate(projectApi.requestBodySchema(createTask).schema!, { name: 'Sans champs', status: 'Doing' }))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('$.fields: propriété requise manquante'),
        expect.stringContaining('$.status: aucune alternative anyOf'),
      ]));
  });

  test('resolves BFF User session unions', () => {
    const body = { ...sessionResponse(agents.alice), roles: ['User', { id: 3 }] };
    expect(userBff.validate(responseSchema(userBff, 'get', userBffUrls.getGetMeUrl(), 200), body))
      .toEqual([expect.stringContaining('$.roles[1]: aucune alternative anyOf')]);
  });
});
