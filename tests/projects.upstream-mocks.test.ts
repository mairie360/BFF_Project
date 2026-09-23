import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { ContractMockServer, unreachableUrl, type MockReply } from './support/contract-mock-server';
import { OpenApiContract } from './support/openapi-contract';
import { loadOrvalContract } from './support/orval-contract';
import type { GetProjectResultView, ProjetView } from '@mairie360/project-api-openapi/model';
import type { ListDirectoryUsersParams } from '@mairie360/core-api-openapi/model';
import {
  agents, bearer, collaboration, coreApiUrls, coreDirectory, createProjectResult, createTaskResult, projectApiUrls, projectBundle,
  projectUsersResult, projectsResult, projetView, sessionResponse, taskComment, taskHistoryEntry, taskView, userBffUrls, type Agent,
} from './support/project-fixtures';

// Toute l'application est testée avec les vrais clients orval/axios contre de vrais serveurs HTTP simulant
// BFF User (GET /me), Project API et Core API (annuaire, /check_apis). Leurs contrats sont reconstruits depuis
// les paquets @mairie360/*-openapi installés (tests/support/orval-contract.ts) : chaque mock refuse les routes,
// paramètres et corps absents du contrat amont et valide ses réponses de succès. Les erreurs ne sont pas typées
// par orval : toute réponse d'erreur simulée est marquée `outOfContract`. Chaque réponse du BFF est validée
// contre contracts/openapi.json. Le BFF n'a plus d'accès à PostgreSQL. Les corps simulés sont typés par les modèles
// générés et les chemins attendus viennent des helpers d'URL des clients générés.

const userBff = new ContractMockServer('USER_BFF', loadOrvalContract('@mairie360/bff-user-openapi'));
const projectApi = new ContractMockServer('PROJECT_API', loadOrvalContract('@mairie360/project-api-openapi'));
const coreApi = new ContractMockServer('CORE_API', loadOrvalContract('@mairie360/core-api-openapi'));
const mocks = [userBff, projectApi, coreApi];
// Gabarits des contrats amont (clés des mocks) ; les chemins concrets attendus viennent des helpers d'URL.
const PROJECT = {
  projects: '/api/v1/projects/',
  project: '/api/v1/projects/{projectId}/',
  close: '/api/v1/projects/{projectId}/close',
  users: '/api/v1/projects/{projectId}/users/',
  user: '/api/v1/projects/{projectId}/users/{userId}/',
  tasks: '/api/v1/projects/{projectId}/tasks/',
  task: '/api/v1/projects/{projectId}/tasks/{taskId}/',
  collaboration: '/api/v1/projects/{projectId}/tasks/{taskId}/collaboration',
  comments: '/api/v1/projects/{projectId}/tasks/{taskId}/comments',
  history: '/api/v1/projects/{projectId}/tasks/{taskId}/history',
  health: '/health',
} as const;
const CORE = { directory: '/api/v1/user/', health: '/health' } as const;
const USER_BFF = { me: '/me' } as const;
const bffContract = OpenApiContract.load(path.join(__dirname, '..', 'contracts', 'openapi.json'));

const { admin, alice, marie } = agents;

let app: Express;

beforeAll(async () => {
  await Promise.all(mocks.map((mock) => mock.start()));
  // projectClient lit PROJECT_API_BASE_PATH au chargement : l'application est importée après.
  process.env.PROJECT_API_BASE_PATH = projectApi.url;
  app = (await import('../src/app')).default;
});
afterAll(async () => { await Promise.all(mocks.map((mock) => mock.stop())); });

beforeEach(() => {
  for (const mock of mocks) mock.reset();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  // project-user.ts et coreDirectory relisent leurs URL à chaque requête.
  process.env.USER_BFF_URL = userBff.url;
  const coreApiUrl = new URL(coreApi.url);
  process.env.CORE_API_URL = coreApiUrl.hostname;
  process.env.CORE_API_PORT = coreApiUrl.port;
  const projectApiUrl = new URL(projectApi.url);
  process.env.PROJECT_API_URL = projectApiUrl.hostname;
  process.env.PROJECT_API_PORT = projectApiUrl.port;
  // Annuaire Core : la restriction par groupes est appliquée comme par Core API.
  coreApi.on('get', CORE.directory, ({ url }) => {
    const { group_ids }: Pick<ListDirectoryUsersParams, 'group_ids'> = Object.fromEntries(url.searchParams);
    const groupIds = group_ids?.split(',').map(Number);
    const directory = [admin, alice, marie];
    return {
      body: coreDirectory(groupIds ? directory.filter((agent) => agent.id !== admin.id) : directory),
    };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  expect(mocks.flatMap((mock) => mock.violations)).toEqual([]);
});

function expectBffContract(method: string, pathname: string, response: request.Response) {
  const match = bffContract.match(method, pathname);
  expect(match?.template).toBeDefined();
  const { documented, schema } = bffContract.responseSchema(match!, response.status);
  expect({ status: response.status, documented }).toEqual({ status: response.status, documented: true });
  if (schema) expect(bffContract.validate(schema, response.body)).toEqual([]);
}

const signIn = (agent: Agent, reply: MockReply = { body: sessionResponse(agent) }) => userBff.on('get', USER_BFF.me, reply);
const as = (call: request.Test, agent: Agent) => call.set('Authorization', bearer(agent.id));
/** Appels reçus par Project API, sous la forme `MÉTHODE chemin` (chemin tel que le construit le client généré). */
const upstreamSequence = () => projectApi.requests.map((call) => `${call.method} ${call.url.pathname}`);
const called = (method: string, url: string) => `${method} ${url}`;
/** Erreur texte d'actix/mairie360_api_lib : non typée par orval, donc hors contrat. */
const textError = (status: number, raw: string): MockReply => ({ status, raw, contentType: 'text/plain', outOfContract: true });

type Scenario = {
  projects?: ProjetView[];
  bundles?: Record<number, GetProjectResultView>;
  createdProjectId?: number;
  createdTaskId?: number;
};

function mockProjectApi({ projects = [], bundles = {}, createdProjectId = 12, createdTaskId = 30 }: Scenario = {}) {
  projectApi.on('get', PROJECT.projects, { body: projectsResult(projects) });
  projectApi.on('get', PROJECT.project, ({ pathParams }) => {
    const bundle = bundles[Number(pathParams.projectId)];
    // 404 renvoyé par Project API pour un projet inexistant ou invisible (erreurs non typées par orval).
    return bundle ? { body: bundle } : textError(404, 'Unknown project.');
  });
  projectApi.on('post', PROJECT.projects, { body: createProjectResult(createdProjectId) });
  projectApi.on('patch', PROJECT.project, { status: 204 });
  projectApi.on('patch', PROJECT.close, { status: 200 });
  projectApi.on('delete', PROJECT.project, { status: 204 });
  projectApi.on('get', PROJECT.users, ({ pathParams }) => ({ body: projectUsersResult(bundles[Number(pathParams.projectId)]?.users ?? []) }));
  projectApi.on('post', PROJECT.users, { status: 200 });
  projectApi.on('delete', PROJECT.user, { status: 204 });
  projectApi.on('post', PROJECT.tasks, { body: createTaskResult(createdTaskId) });
  projectApi.on('patch', PROJECT.task, { status: 204 });
  projectApi.on('delete', PROJECT.task, { status: 204 });
  projectApi.on('post', PROJECT.history, { status: 201, body: taskHistoryEntry() });
}

describe('Project BFF with contract-driven BFF User, Project API and Core API mocks', () => {
  describe('session resolution through BFF User GET /me', () => {
    test('rejects project routes without a bearer before calling any upstream', async () => {
      const responses = await Promise.all([
        request(app).get('/projects-page'),
        request(app).get('/projects-page').set('Authorization', 'Basic YWRtaW46YWRtaW4='),
      ]);

      expect(responses.map((response) => [response.status, response.body.error.code])).toEqual([[401, 'UNAUTHORIZED'], [401, 'UNAUTHORIZED']]);
      responses.forEach((response) => expectBffContract('get', '/projects-page', response));
      expect(mocks.flatMap((mock) => mock.requests)).toEqual([]);
    });

    test('forwards the caller session to /me and normalizes role aliases', async () => {
      signIn(marie, { body: { ...sessionResponse(marie, { role: 'manager' }), roles: ['Utilisateur', { id: 9, name: 'ROLE_RESPONSABLE' }] } });
      mockProjectApi();

      const response = await as(request(app).get('/projects-page'), marie);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.access).toEqual({
        role: 'Responsable', scope: 'team', canCreateProject: true, canManageProjects: true, canManageTasks: true,
        canUpdateAssignedTaskStatus: true, canCommentTasks: true,
      });
      const [me] = userBff.calls(USER_BFF.me, 'get');
      expect(me.url.pathname).toBe(userBffUrls.getGetMeUrl());
      expect(me.headers.authorization).toBe(bearer(marie.id));
      expect(projectApi.calls(PROJECT.projects, 'get')[0].headers.authorization).toBe(bearer(marie.id));
    });

    test.each([
      ['a BFF User 500', { status: 500, body: { message: 'boom' }, outOfContract: true }, 'Le contexte utilisateur est indisponible.'],
      ['an invalid JSON body', { raw: '<html>proxy</html>', contentType: 'text/html' }, 'Le contexte utilisateur est indisponible.'],
      ['a dropped connection', { dropConnection: true }, 'Le service utilisateur est indisponible.'],
    ] as Array<[string, MockReply, string]>)('maps %s to 502 without leaking details', async (_label, reply, message) => {
      signIn(alice, reply);

      const response = await as(request(app).get('/projects-page'), alice);

      expect(response.status).toBe(502);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message, details: [] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test('propagates a BFF User 401 and an unreachable BFF User', async () => {
      signIn(alice, { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Token expiré', details: [] } }, outOfContract: true });
      const refused = await as(request(app).get('/projects-page'), alice);

      process.env.USER_BFF_URL = await unreachableUrl();
      const unreachable = await as(request(app).get('/projects-page'), alice);

      expect(refused.status).toBe(401);
      expect(refused.body.error.message).toBe('La session a expiré.');
      expect(unreachable.status).toBe(502);
      expect(unreachable.body.error.message).toBe('Le service utilisateur est indisponible.');
    });
  });

  describe('reads', () => {
    test('GET /projects-page builds the page from the projects Project API exposes to the caller', async () => {
      signIn(admin);
      mockProjectApi({
        projects: [projetView(1, { name: 'Rénovation de la médiathèque' }), projetView(2, { name: 'Archivage', status: 'Completed' })],
        bundles: {
          1: projectBundle(projetView(1, { name: 'Rénovation de la médiathèque' }), [
            taskView(1, { status: 'Completed', priority: 'High', due_date: '2026-11-01T00:00:00.000Z' }),
            taskView(2, { priority: 'Low', due_date: '2026-10-15T00:00:00.000Z', assigned_to: alice.id }),
          ], [alice, marie]),
          2: projectBundle(projetView(2, { name: 'Archivage', status: 'Completed' }), [taskView(3, { status: 'Completed' })]),
        },
      });

      const response = await as(request(app).get('/projects-page?status=in-progress&limit=10&page=1&view=table'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.projects).toEqual([expect.objectContaining({
        id: 'project-1', title: 'Rénovation de la médiathèque', status: 'in-progress', priority: 'high',
        progress: 50, dueDate: '2026-10-15T00:00:00.000Z',
        responsible: { id: 'user-2', name: 'Alice Martin', avatarUrl: null },
        tasks: { total: 2, completed: 1 },
        permissions: { canView: true, canEdit: true, canDuplicate: true, canDelete: true, canCreateTask: true, canAssignMembers: true, canClose: true },
      })]);
      expect(response.body.summary.totalProjects).toBe(1);
      // Les membres proposés viennent de l'annuaire Core, pas des projets.
      expect(response.body.options.members.map((option: { value: string }) => option.value)).toEqual(['user-1', 'user-2', 'user-3']);
      expect(upstreamSequence().sort()).toEqual([called('GET', projectApiUrls.getGetProjectsUrl()), called('GET', projectApiUrls.getGetProjectUrl(1)), called('GET', projectApiUrls.getGetProjectUrl(2))]);
    });

    test('GET /projects/:id returns the project an employee may see, with only their tasks', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [
        taskView(1, { assigned_to: marie.id }),
        taskView(2, { assigned_to: alice.id, status: 'InProgress' }),
      ], [alice, marie]) } });

      const response = await as(request(app).get('/projects/project-1'), alice);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body.project.permissions.canEdit).toBe(false);
      expect(response.body.taskItems).toEqual([expect.objectContaining({
        id: 'task-2', status: 'in-progress',
        permissions: { canView: true, canEdit: false, canDelete: false, canUpdateStatus: true, canComment: true },
      })]);
    });

    test('GET /projects/:id answers 404 for a project Project API does not expose to the caller', async () => {
      signIn(alice);
      mockProjectApi();

      const response = await as(request(app).get('/projects/project-9'), alice);

      expect(response.status).toBe(404);
      expectBffContract('get', '/projects/project-9', response);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('GET /projects/:id/tasks/:taskId/collaboration returns the comments and history of Project API', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      const author = { id: 'user-2', name: 'Alice Martin' };
      projectApi.on('get', PROJECT.collaboration, { body: collaboration(
        [taskComment({ author })],
        [taskHistoryEntry({
          id: 'status-4', action: 'status_changed', label: 'Statut modifié : todo → in_progress',
          author, createdAt: '2026-09-02T08:00:00.000Z', changes: { status: { from: 'todo', to: 'in_progress' } },
        })],
      ) });

      const response = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1/tasks/task-2/collaboration', response);
      expect(response.body.comments[0].message).toBe('Devis reçu.');
      expect(response.body.history[0].action).toBe('status_changed');
    });

    test('maps a Project API failure to 502 without leaking its body', async () => {
      signIn(admin);
      mockProjectApi();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      projectApi.on('get', PROJECT.projects, textError(500, 'An error occurred while accessing the database.'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(502);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message: 'Project API est indisponible.', details: [] });
      expect(JSON.stringify(response.body)).not.toContain('database');
    });
  });

  describe('writes', () => {
    const createBody = {
      title: 'Fête du village', description: 'Organisation de la fête', status: 'todo', priority: 'medium',
      responsibleId: 'user-2', assigneeIds: ['user-3'], labels: ['événement'], dueDate: '2026-07-14T00:00:00Z',
      taskItems: [{ title: 'Réserver la salle', status: 'todo', priority: 'high', assigneeIds: [], labels: ['Urgent'], dueDate: '2026-06-25T00:00:00Z' }],
    };

    test('POST /projects creates the project, its members and its tasks through Project API', async () => {
      signIn(marie);
      mockProjectApi({ createdProjectId: 12, createdTaskId: 30, bundles: {
        12: projectBundle(projetView(12, { name: 'Fête du village' }), [taskView(30, { title: 'Réserver la salle' })], [alice, marie]),
      } });
      // Le projet vient d'être créé : Project API ne lui connaît encore aucun membre.
      projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

      const response = await as(request(app).post('/projects'), marie).send(createBody);

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects', response);
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toEqual({ name: 'Fête du village', description: 'Organisation de la fête' });
      expect(projectApi.calls(PROJECT.users, 'POST').map((call) => call.body))
        .toEqual(expect.arrayContaining([{ user_id: alice.id }, { user_id: marie.id }]));
      expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ name: 'Réserver la salle' });
      expect(response.body.project.title).toBe('Fête du village');
    });

    test('PATCH /projects/:id updates the project through Project API and re-reads it', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { name: 'Voirie 2027' }), [], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), marie).send({ title: 'Voirie 2027' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', response);
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ name: 'Voirie 2027' });
      expect(response.body.project.title).toBe('Voirie 2027');
    });

    test('PATCH /projects/:id/close suspends or completes the project through Project API', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1, { status: 'Suspended' }), [taskView(2)], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1/close'), marie).send({ status: 'review' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/close', response);
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ status: 'Suspended' });
      expect(response.body.project.status).toBe('review');
    });

    test('PATCH /projects/:id/tasks/:taskId patches the task and records the history', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { title: 'Renommée' })], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1/tasks/task-2'), marie).send({ title: 'Renommée' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2', response);
      expect(projectApi.calls(PROJECT.task, 'PATCH')[0].body).toEqual({ name: 'Renommée' });
      const [history] = projectApi.calls(PROJECT.history, 'POST');
      expect(history.body).toMatchObject({ action: 'task_updated' });
    });

    test('POST /projects/:id/tasks/:taskId/comments stores the comment through Project API', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]) } });
      projectApi.on('post', PROJECT.comments, { status: 201, body: taskComment({
        id: 'comment-9', message: 'Fait.', author: { id: `user-${alice.id}`, name: 'Alice Martin' }, createdAt: '2026-09-16T10:00:00.000Z',
      }) });

      const response = await as(request(app).post('/projects/project-1/tasks/task-2/comments'), alice).send({ message: 'Fait.' });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/tasks/task-2/comments', response);
      expect(projectApi.calls(PROJECT.comments, 'POST')[0].body).toEqual({ message: 'Fait.' });
      expect(response.body.message).toBe('Fait.');
    });

    test('POST /projects/:id/tasks creates the task and returns it from the re-read bundle', async () => {
      signIn(marie);
      mockProjectApi({ createdTaskId: 30, bundles: { 1: projectBundle(projetView(1), [taskView(30, { title: 'Réserver la salle', assigned_to: alice.id })], [alice, marie]) } });

      const response = await as(request(app).post('/projects/project-1/tasks'), marie).send({
        title: 'Réserver la salle', status: 'todo', priority: 'high',
        responsibleId: 'user-2', assigneeIds: ['user-2'], labels: ['Urgent'], dueDate: '2026-06-25T00:00:00Z',
      });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/tasks', response);
      expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ name: 'Réserver la salle' });
      expect(projectApi.calls(PROJECT.history, 'POST')[0].body).toMatchObject({ action: 'task_created' });
      expect(response.body).toMatchObject({ id: 'task-30', title: 'Réserver la salle' });
    });

    test('POST /projects/:id/tasks answers 404 when the created task is missing from the bundle', async () => {
      signIn(marie);
      mockProjectApi({ createdTaskId: 99, bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

      const response = await as(request(app).post('/projects/project-1/tasks'), marie).send({
        title: 'Fantôme', status: 'todo', priority: 'low', responsibleId: 'user-3', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z',
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('POST /projects/:id/duplicate recreates the project, its members and its tasks', async () => {
      signIn(marie);
      mockProjectApi({ createdProjectId: 12, bundles: {
        1: projectBundle(projetView(1, { name: 'Voirie' }), [taskView(2, { title: 'Appel d\u2019offres' })], [alice, marie]),
        12: projectBundle(projetView(12, { name: 'Voirie' }), [taskView(30, { title: 'Appel d\u2019offres' })], [alice, marie]),
      } });
      // Le duplicata est vide tant que ses membres n'ont pas été ajoutés.
      projectApi.on('get', PROJECT.users, { body: projectUsersResult([]) });

      const response = await as(request(app).post('/projects/project-1/duplicate'), marie).send({});

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects/project-1/duplicate', response);
      expect(projectApi.calls(PROJECT.projects, 'POST')[0].body).toMatchObject({ name: 'Voirie' });
      expect(projectApi.calls(PROJECT.users, 'POST').map((call) => call.body))
        .toEqual(expect.arrayContaining([{ user_id: alice.id }, { user_id: marie.id }]));
      expect(projectApi.calls(PROJECT.tasks, 'POST')[0].body).toMatchObject({ name: 'Appel d\u2019offres' });
      expect(response.body.taskItems).toHaveLength(1);
    });

    test('an unknown project answers 404 on every write route', async () => {
      signIn(marie);
      mockProjectApi();

      const responses = await Promise.all([
        as(request(app).patch('/projects/project-9'), marie).send({ title: 'Voirie' }),
        as(request(app).post('/projects/project-9/duplicate'), marie).send({}),
        as(request(app).delete('/projects/project-9'), marie),
        as(request(app).patch('/projects/project-9/tasks/task-2'), marie).send({ title: 'Renommée' }),
        as(request(app).get('/projects/project-9/tasks/task-2/collaboration'), marie),
      ]);

      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
      expect(projectApi.calls(PROJECT.project, 'DELETE')).toHaveLength(0);
    });

    test('DELETE removes a task and a project through Project API', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [marie]) } });

      const task = await as(request(app).delete('/projects/project-1/tasks/task-2'), marie);
      const project = await as(request(app).delete('/projects/project-1'), marie);

      expect([task.status, project.status]).toEqual([204, 204]);
      expectBffContract('delete', '/projects/project-1/tasks/task-2', task);
      expect(projectApi.calls(PROJECT.task, 'DELETE')).toHaveLength(1);
      expect(projectApi.calls(PROJECT.project, 'DELETE')).toHaveLength(1);
    });
  });

  describe('request validation and permissions', () => {
    test.each([
      ['get', '/projects-page?status=archived', undefined],
      ['post', '/projects', { title: 'Sans description' }],
      ['patch', '/projects/project-x', { title: 'Voirie' }],
      ['patch', '/projects/project-1/tasks/task-x', { title: 'Renommée' }],
      ['post', '/projects/project-1/tasks/task-2/comments', { message: '   ' }],
      ['post', '/projects/project-1/tasks/task-2/comments', { message: '<script>alert(1)</script>' }],
      ['patch', '/projects/project-1', { description: '<img src=x onerror=alert(1)>' }],
      ['patch', '/projects/project-1', { labels: ['<b>urgent</b>'] }],
      ['patch', '/projects/project-1/tasks/task-2', { responsibleId: '() { :;}; /bin/sleep 15' }],
      ['patch', '/projects/project-1/tasks/task-2', { assigneeIds: ['Jane Doe'] }],
      ['patch', '/projects/project-1/tasks/task-2', { assigneeIds: ['task-1'] }],
      ['get', '/projects-page?dueAfter=not-a-date', undefined],
    ] as const)('%s %s answers 400 without calling Project API', async (method, url, body) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const call = as(request(app)[method](url), admin);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
    });

    test('a malformed JSON body answers a JSON 400, not the Express HTML error page', async () => {
      signIn(admin);

      const response = await as(request(app).patch('/projects/project-1/close'), admin)
        .set('Content-Type', 'application/json')
        .send('{"status":');

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid request', details: [] } });
    });

    test.each([
      ['patch', '/projects/project-1', { title: 'Voirie' }],
      ['post', '/projects/project-1/duplicate', {}],
      ['delete', '/projects/project-1', undefined],
      ['post', '/projects/project-1/tasks', { title: 'Réserver', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
    ] as const)('%s %s answers 403 for an employee who may only read the project', async (method, url, body) => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [alice]) } });

      const call = as(request(app)[method](url), alice);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(403);
      expect(response.body.error).toMatchObject({ code: 'FORBIDDEN' });
    });

    test('an employee may update the status of their own task but not its content', async () => {
      signIn(alice);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]) } });

      const status = await as(request(app).patch('/projects/project-1/tasks/task-2/status'), alice).send({ status: 'done' });
      const content = await as(request(app).patch('/projects/project-1/tasks/task-2'), alice).send({ title: 'Renommée' });

      expect(status.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2/status', status);
      expect(projectApi.calls(PROJECT.task, 'PATCH')[0].body).toEqual({ status: 'Completed' });
      expect(content.status).toBe(403);
    });
  });

  describe('GET /check_apis', () => {
    beforeEach(() => {
      projectApi.on('get', PROJECT.health, { raw: 'OK', contentType: 'text/plain' });
      coreApi.on('get', CORE.health, { raw: 'OK', contentType: 'text/plain' });
    });

    test('reports both APIs connected through their /health operations', async () => {
      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(200);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'OK', core_api: 'Connected', project_api: 'Connected' });
      expect(upstreamSequence()).toEqual([called('GET', projectApiUrls.getHealthUrl())]);
      expect(coreApi.requests.map((call) => call.url.pathname)).toEqual([coreApiUrls.getHealthUrl()]);
    });

    test.each([
      ['Project API', () => projectApi.on('get', PROJECT.health, { dropConnection: true }), { core_api: 'Connected', project_api: 'Unreachable' }],
      ['Core API', () => coreApi.on('get', CORE.health, { dropConnection: true }), { core_api: 'Unreachable', project_api: 'Connected' }],
    ])('answers 502 when %s is unreachable', async (_service, breakService, expected) => {
      breakService();

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({ status: 'Error', ...expected });
    });
  });
});
