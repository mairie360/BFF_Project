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
  health: '/health',
} as const;
const CORE = { directory: '/api/v1/user/', health: '/health' } as const;
const USER_BFF = { me: '/me', health: '/health' } as const;
const bffContract = OpenApiContract.load(path.join(__dirname, '..', 'contracts', 'openapi.json'));

const { admin, alice, marie } = agents;

let app: Express;

beforeAll(async () => {
  await Promise.all(mocks.map((mock) => mock.start()));
  app = (await import('../src/app')).default;
});
afterAll(async () => { await Promise.all(mocks.map((mock) => mock.stop())); });

beforeEach(() => {
  for (const mock of mocks) mock.reset();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  // Every upstream URL (<SERVICE>_URL + <SERVICE>_PORT) is read again on every call.
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

/** A `/me` body without `user.id` (optional in the BFF User contract). */
function withoutUserId(session: ReturnType<typeof sessionResponse>) {
  const user = { ...session.user };
  delete user.id;
  return { ...session, user };
}
const signIn = (agent: Agent, reply: MockReply = { body: sessionResponse(agent) }) => userBff.on('get', USER_BFF.me, reply);
const as = (call: request.Test, agent: Agent) => call.set('Authorization', bearer(agent.id));
/** Appels reçus par Project API, sous la forme `MÉTHODE chemin` (chemin tel que le construit le client généré). */
const upstreamSequence = () => projectApi.requests.map((call) => `${call.method} ${call.url.pathname}`);
const called = (method: string, url: string) => `${method} ${url}`;
/** Project API writes the task history itself (database trigger): the BFF never posts to a `/history` path. */
const historyWrites = () => projectApi.requests.filter((call) => call.url.pathname.endsWith('/history'));
/** `limit` / `offset` query of a paginated Project API call, with Project API's defaults (100, 0). */
const pageOf = (url: URL) => ({ limit: Number(url.searchParams.get('limit') ?? 100), offset: Number(url.searchParams.get('offset') ?? 0) });
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
}

describe('Project BFF with contract-driven BFF User, Project API and Core API mocks', () => {
  test('every response carries the shared security headers and no X-Powered-By', async () => {
    const [api, docs, malformed] = await Promise.all([
      request(app).get('/health'),
      request(app).get('/docs/'),
      as(request(app).patch('/projects/project-1/close'), admin).set('Content-Type', 'application/json').send('{"status":'),
    ]);

    for (const response of [api, docs, malformed]) {
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    }
    // The JSON API surface (body-parse errors included) gets the strict API-only headers; /docs keeps the
    // shared policy its scripts and styles need.
    for (const response of [api, malformed]) {
      expect(response.headers['content-security-policy']).toBe("default-src 'none'");
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['permissions-policy']).toBe('geolocation=(), camera=(), microphone=()');
    }
    expect(docs.headers['content-security-policy']).toContain("default-src 'self'");
  });

  describe('session resolution through BFF User GET /me', () => {
    test('rejects project routes without a bearer before calling any upstream', async () => {
      const responses = await Promise.all([
        request(app).get('/projects-page'),
        request(app).get('/projects-page').set('Authorization', 'Basic YWRtaW46YWRtaW4='),
        request(app).get('/projects-page').set('Authorization', 'Bearer'),
        request(app).get('/projects-page').set('Authorization', 'Bearer two words'),
        // The access token is only read from the Authorization header: cookies and x-session-token are ignored.
        request(app).get('/projects-page').set('Cookie', 'accessToken=abc.def.ghi; session=abc.def.ghi'),
        request(app).get('/projects-page').set('x-session-token', 'abc.def.ghi'),
        request(app).post('/projects').send({}),
      ]);

      expect(responses.map((response) => [response.status, response.body.error.code])).toEqual(Array(7).fill([401, 'UNAUTHORIZED']));
      expect(responses.map((response) => response.headers['cache-control'])).toEqual(Array(7).fill('no-store'));
      responses.slice(0, 6).forEach((response) => expectBffContract('get', '/projects-page', response));
      expectBffContract('post', '/projects', responses[6]);
      expect(mocks.flatMap((mock) => mock.requests)).toEqual([]);
    });

    test('session-bound answers are never cached and the normalised Bearer header is forwarded', async () => {
      signIn(admin);
      mockProjectApi();

      const response = await request(app).get('/projects-page').set('Authorization', `  bearer   ${bearer(admin.id).slice('Bearer '.length)}  `);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(userBff.calls(USER_BFF.me, 'get')[0].headers.authorization).toBe(bearer(admin.id));
      expect(projectApi.calls(PROJECT.projects, 'get')[0].headers.authorization).toBe(bearer(admin.id));
      expect(coreApi.calls(CORE.directory, 'get')[0].headers.authorization).toBe(bearer(admin.id));
    });

    test('falls back on the token sub when BFF User returns no user id', async () => {
      signIn(alice, { body: withoutUserId(sessionResponse(alice)) });
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { assigned_to: alice.id })], [alice]) } });

      const response = await as(request(app).get('/projects/project-1'), alice);

      expect(response.status).toBe(200);
      // The task assigned to the caller (id read from the sub of the token BFF User accepted) is visible.
      expect(response.body.taskItems.map((task: { id: string }) => task.id)).toEqual(['task-2']);
    });

    test('answers 401 when neither BFF User nor the token identify the caller', async () => {
      signIn(alice, { body: withoutUserId(sessionResponse(alice)) });
      const opaque = await request(app).get('/projects-page').set('Authorization', 'Bearer opaque-token');

      expect(opaque.status).toBe(401);
      expect(projectApi.requests).toHaveLength(0);
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
      ['a BFF User 500', { status: 500, body: { message: 'boom' }, outOfContract: true }, 'Upstream service error'],
      ['a BFF User 403', { status: 403, body: { message: 'forbidden' }, outOfContract: true }, 'Upstream service error'],
      ['an invalid JSON body', { raw: '<html>proxy</html>', contentType: 'text/html' }, 'The USER_BFF answer is invalid.'],
      ['a dropped connection', { dropConnection: true }, 'The USER_BFF service is unavailable.'],
    ] as Array<[string, MockReply, string]>)('maps %s to 502 without leaking details', async (_label, reply, message) => {
      signIn(alice, reply);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await as(request(app).get('/projects-page'), alice);

      expect(response.status).toBe(502);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message, details: [] });
      expect(projectApi.requests).toHaveLength(0);
    });

    test('propagates a BFF User 401 and an unreachable BFF User', async () => {
      signIn(alice, { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Token expiré', details: [] } }, outOfContract: true });
      const refused = await as(request(app).get('/projects-page'), alice);

      process.env.USER_BFF_URL = await unreachableUrl();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const unreachable = await as(request(app).get('/projects-page'), alice);

      expect(refused.status).toBe(401);
      expect(refused.body.error).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required', details: [] });
      expect(unreachable.status).toBe(502);
      expect(unreachable.body.error.message).toBe('The USER_BFF service is unavailable.');
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
      // The status filter runs on the list: the bundle of the Completed project is never read.
      expect(upstreamSequence().sort()).toEqual([called('GET', projectApiUrls.getGetProjectsUrl()), called('GET', projectApiUrls.getGetProjectUrl(1))]);
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

    test('GET /projects-page reads every page of the Project API project list', async () => {
      signIn(admin);
      const projects = [projetView(1), projetView(2), projetView(3)];
      mockProjectApi({ bundles: Object.fromEntries(projects.map((project) => [project.id, projectBundle(project, [taskView(project.id)])])) });
      // Pages of two projects, whatever limit the BFF asks for.
      projectApi.on('get', PROJECT.projects, ({ url }) => {
        const { offset } = pageOf(url);
        return { body: projectsResult(projects.slice(offset, offset + 2), projects.length) };
      });

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.projects.map((project: { id: string }) => project.id).sort()).toEqual(['project-1', 'project-2', 'project-3']);
      expect(projectApi.calls(PROJECT.projects, 'GET').map((call) => pageOf(call.url).offset)).toEqual([0, 2]);
    });

    test('GET /projects/:id reads every page of tasks and every member past the embedded ones', async () => {
      signIn(admin);
      const tasks = [taskView(1), taskView(2), taskView(3)];
      const users = [admin, alice, marie];
      mockProjectApi();
      projectApi.on('get', PROJECT.project, ({ url }) => {
        const { offset } = pageOf(url);
        // Two tasks per page, and only the first member embedded.
        return { body: projectBundle(projetView(1), tasks.slice(offset, offset + 2), users.slice(0, 1), { tasks_total: 3, users_total: 3 }) };
      });
      projectApi.on('get', PROJECT.users, ({ url }) => {
        const { offset } = pageOf(url);
        return { body: projectUsersResult(users.slice(offset, offset + 2).map((agent) => ({ id: agent.id, name: `${agent.first_name} ${agent.last_name}` })), 3) };
      });

      const response = await as(request(app).get('/projects/project-1'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body.taskItems.map((task: { id: string }) => task.id)).toEqual(['task-1', 'task-2', 'task-3']);
      expect(projectApi.calls(PROJECT.project, 'GET').map((call) => pageOf(call.url).offset)).toEqual([0, 2]);
      expect(projectApi.calls(PROJECT.users, 'GET').map((call) => pageOf(call.url).offset)).toEqual([0, 2]);
    });

    test('GET /projects/:id/tasks/:taskId/collaboration reads every page of comments and history', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      const comments = [taskComment({ id: 'comment-1' }), taskComment({ id: 'comment-2' }), taskComment({ id: 'comment-3' })];
      const history = [taskHistoryEntry({ id: 'history-1' })];
      projectApi.on('get', PROJECT.collaboration, ({ url }) => {
        const { offset } = pageOf(url);
        return { body: collaboration(comments.slice(offset, offset + 2), history.slice(offset, offset + 2), {
          comments_total: comments.length, history_total: history.length,
        }) };
      });

      const response = await as(request(app).get('/projects/project-1/tasks/task-2/collaboration'), admin);

      expect(response.status).toBe(200);
      expectBffContract('get', '/projects/project-1/tasks/task-2/collaboration', response);
      expect(response.body.comments.map((comment: { id: string }) => comment.id)).toEqual(['comment-1', 'comment-2', 'comment-3']);
      expect(response.body.history.map((entry: { id: string }) => entry.id)).toEqual(['history-1']);
      expect(projectApi.calls(PROJECT.collaboration, 'GET').map((call) => pageOf(call.url).offset)).toEqual([0, 2]);
    });

    test('maps a Project API failure to 502 without leaking its body', async () => {
      signIn(admin);
      mockProjectApi();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      projectApi.on('get', PROJECT.projects, textError(500, 'An error occurred while accessing the database.'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(502);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'BAD_GATEWAY', message: 'Upstream service error', details: [] });
      expect(JSON.stringify(response.body)).not.toContain('database');
    });

    test('retries an idempotent Project API read once after a transient failure', async () => {
      signIn(admin);
      mockProjectApi();
      let calls = 0;
      projectApi.on('get', PROJECT.projects, () => (++calls === 1
        ? { status: 503, raw: 'busy', contentType: 'text/plain', outOfContract: true }
        : { body: projectsResult([]) }));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(200);
      expect(projectApi.calls(PROJECT.projects, 'get')).toHaveLength(2);
    });

    test('never retries a write', async () => {
      signIn(admin);
      mockProjectApi();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      projectApi.on('post', PROJECT.projects, { status: 503, raw: 'busy', contentType: 'text/plain', outOfContract: true });

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'todo', priority: 'medium',
        responsibleId: '', assigneeIds: [], labels: [], dueDate: '2030-07-14T00:00:00Z',
      });

      expect(response.status).toBe(502);
      expectBffContract('post', '/projects', response);
      expect(projectApi.calls(PROJECT.projects, 'POST')).toHaveLength(1);
    });

    test.each([403, 404, 409, 501])('maps a Project API %i the route does not declare to 502', async (status) => {
      signIn(admin);
      mockProjectApi();
      projectApi.on('get', PROJECT.projects, textError(status, 'Project API internals'));

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(502);
      expectBffContract('get', '/projects-page', response);
      expect(response.body).toEqual({ error: { code: 'BAD_GATEWAY', message: 'Upstream service error', details: [] } });
    });

    test('keeps a Project API 404 the route declares, with a generic message', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });
      projectApi.on('post', PROJECT.comments, textError(404, 'Unknown task 2.'));

      const response = await as(request(app).post('/projects/project-1/tasks/task-2/comments'), admin).send({ message: 'Devis reçu.' });

      expect(response.status).toBe(404);
      expectBffContract('post', '/projects/project-1/tasks/task-2/comments', response);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found', details: [] } });
    });

    test('answers a generic 500 when an unexpected error happens, without leaking it', async () => {
      signIn(admin);
      mockProjectApi();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      // A success body the mapping cannot read: the TypeError it raises must stay in the logs.
      projectApi.on('get', PROJECT.project, { body: { project: null, tasks: null, users: null }, outOfContract: true });

      const response = await as(request(app).get('/projects/project-1'), admin);

      expect(response.status).toBe(500);
      expectBffContract('get', '/projects/project-1', response);
      expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: [] } });
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

    test('PATCH /projects/:id/tasks/:taskId patches the task and leaves the history to Project API', async () => {
      signIn(marie);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { title: 'Renommée' })], [marie]) } });

      const response = await as(request(app).patch('/projects/project-1/tasks/task-2'), marie).send({ title: 'Renommée' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1/tasks/task-2', response);
      expect(projectApi.calls(PROJECT.task, 'PATCH')[0].body).toEqual({ name: 'Renommée' });
      expect(historyWrites()).toEqual([]);
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
      expect(historyWrites()).toEqual([]);
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
      expectBffContract(method, url.split('?')[0], response);
      expect(response.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Validation failed' });
      // Every detail names where the invalid value was read: body.<field>, params.<param> or query.<param>.
      expect(response.body.error.details.length).toBeGreaterThan(0);
      for (const detail of response.body.error.details) {
        expect(detail).toEqual({ path: expect.stringMatching(/^(body|params|query)(\.|$)/), message: expect.any(String) });
      }
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
    });

    test.each([
      ['get', '/projects/project-x', undefined],
      ['patch', '/projects/project-x/close', { status: 'done' }],
      ['delete', '/projects/project-x', undefined],
      ['post', '/projects/project-x/duplicate', {}],
      ['post', '/projects/project-x/tasks', { title: 'Réserver la salle', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      ['delete', '/projects/project-1/tasks/task-x', undefined],
      ['patch', '/projects/project-1/tasks/task-x/status', { status: 'done' }],
      ['get', '/projects/project-1/tasks/task-x/collaboration', undefined],
      ['post', '/projects/project-1/tasks/task-x/comments', { message: 'Devis reçu.' }],
    ] as const)('%s %s answers 400 for an identifier without a numeric suffix', async (method, url, body) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const call = as(request(app)[method](url), admin);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(400);
      expectBffContract(method, url, response);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.details).toEqual([expect.objectContaining({ path: expect.stringMatching(/^params(\.|$)/) })]);
      expect(upstreamSequence()).toEqual([]);
    });

    test.each([
      ['get', '/projects/project-1', undefined],
      ['patch', '/projects/project-1', { title: 'Voirie' }],
      ['patch', '/projects/project-1/close', { status: 'done' }],
      ['delete', '/projects/project-1', undefined],
      ['post', '/projects/project-1/duplicate', {}],
      ['post', '/projects/project-1/tasks', { title: 'Réserver la salle', status: 'todo', priority: 'high', responsibleId: 'user-2', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      ['patch', '/projects/project-1/tasks/task-2', { title: 'Renommée' }],
      ['delete', '/projects/project-1/tasks/task-2', undefined],
      ['patch', '/projects/project-1/tasks/task-2/status', { status: 'done' }],
      ['get', '/projects/project-1/tasks/task-2/collaboration', undefined],
    ] as const)('%s %s maps a Project API 500 to 502 without leaking it', async (method, url, body) => {
      signIn(admin);
      mockProjectApi();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      projectApi.on('get', PROJECT.project, textError(500, 'An error occurred while accessing the database.'));

      const call = as(request(app)[method](url), admin);
      const response = await (body === undefined ? call : call.send(body));

      expect(response.status).toBe(502);
      expectBffContract(method, url, response);
      expect(response.body).toEqual({ error: { code: 'BAD_GATEWAY', message: 'Upstream service error', details: [] } });
    });

    test('validation details point at the invalid fields', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const body = await as(request(app).post('/projects'), admin).send({ title: 'Sans description' });
      const params = await as(request(app).patch('/projects/project-x'), admin).send({ title: 'Voirie' });

      expect(body.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'body.description' })]));
      expect(params.body.error.details).toEqual([expect.objectContaining({ path: 'params.projectId' })]);
    });

    test('an unknown route answers the JSON 404 envelope', async () => {
      const response = await request(app).get('/unknown');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found', details: [] } });
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

  describe('MAIR-399 audit fixes', () => {
    const members = [alice, marie, admin];
    const memberUrl = (projectId: number, userId: number) => called('DELETE', projectApiUrls.getRemoveUserFromProjectUrl(projectId, userId));
    const removedMembers = () => projectApi.calls(PROJECT.user, 'DELETE').map((call) => `${call.method} ${call.url.pathname}`);
    const addedMembers = () => projectApi.calls(PROJECT.users, 'POST').map((call) => call.body);

    test('a PATCH with only responsibleId adds that member and removes nobody', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice, marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ responsibleId: 'user-1' });

      expect(response.status).toBe(200);
      expectBffContract('patch', '/projects/project-1', response);
      expect(addedMembers()).toEqual([{ user_id: admin.id }]);
      expect(removedMembers()).toEqual([]);
      // Nothing to change on the project record itself.
      expect(projectApi.calls(PROJECT.project, 'PATCH')).toHaveLength(0);
    });

    test('a PATCH with only other fields leaves the members untouched', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], members) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ description: 'Nouvelle description' });

      expect(response.status).toBe(200);
      expect(addedMembers()).toEqual([]);
      expect(removedMembers()).toEqual([]);
    });

    test('a PATCH with assigneeIds rewrites the members from the merged state and keeps the current responsible', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], members) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ assigneeIds: [] });

      expect(response.status).toBe(200);
      // alice is the current responsible (first member): she stays, the others are removed.
      expect(removedMembers().sort()).toEqual([memberUrl(1, marie.id), memberUrl(1, admin.id)].sort());
      expect(addedMembers()).toEqual([]);
    });

    test('a PATCH with responsibleId and assigneeIds makes the members exactly that set', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [], [alice, marie]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin).send({ responsibleId: 'user-1', assigneeIds: ['user-3'] });

      expect(response.status).toBe(200);
      expect(addedMembers()).toEqual([{ user_id: admin.id }]);
      expect(removedMembers()).toEqual([memberUrl(1, alice.id)]);
    });

    test('PATCH /projects/:id returns the re-read state, not the unpersisted submitted fields', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2, { priority: 'Low', due_date: '2026-10-15T00:00:00.000Z' })], [admin]) } });

      const response = await as(request(app).patch('/projects/project-1'), admin)
        .send({ priority: 'high', labels: ['urgent'], dueDate: '2030-01-01T00:00:00Z', status: 'todo' });

      expect(response.status).toBe(200);
      expect(response.body.project).toMatchObject({
        priority: 'low', labels: [], dueDate: '2026-10-15T00:00:00.000Z', status: 'in-progress',
      });
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ status: 'Active' });
    });

    test('POST /projects returns the re-read state and persists a closed status', async () => {
      signIn(admin);
      mockProjectApi({ createdProjectId: 12, bundles: {
        12: projectBundle(projetView(12, { name: 'Fête', status: 'Completed' }), [taskView(30, { priority: 'Low', status: 'Completed' })], [alice]),
      } });

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'done', priority: 'high',
        responsibleId: 'user-2', assigneeIds: [], labels: ['événement'], dueDate: '2030-07-14T00:00:00Z',
        taskItems: [{ title: 'Salle', status: 'done', priority: 'low', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      });

      expect(response.status).toBe(201);
      expectBffContract('post', '/projects', response);
      expect(projectApi.calls(PROJECT.project, 'PATCH')[0].body).toEqual({ status: 'Completed' });
      expect(response.body.project).toMatchObject({ status: 'done', priority: 'low', labels: [], progress: 100 });
      expect(response.body.project.dueDate).not.toBe('2030-07-14T00:00:00Z');
    });

    test('POST /projects deletes the created project when a later step fails', async () => {
      signIn(admin);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockProjectApi({ createdProjectId: 12 });
      projectApi.on('post', PROJECT.tasks, textError(500, 'database is down'));

      const response = await as(request(app).post('/projects'), admin).send({
        title: 'Fête', description: 'Organisation', status: 'todo', priority: 'medium',
        responsibleId: '', assigneeIds: [], labels: [], dueDate: '2030-07-14T00:00:00Z',
        taskItems: [{ title: 'Salle', status: 'todo', priority: 'low', assigneeIds: [], labels: [], dueDate: '2026-06-25T00:00:00Z' }],
      });

      expect(response.status).toBe(502);
      expectBffContract('post', '/projects', response);
      expect(upstreamSequence()).toEqual([
        called('POST', projectApiUrls.getCreateProjectUrl()),
        called('POST', projectApiUrls.getCreateTaskUrl(12)),
        called('DELETE', projectApiUrls.getDeleteProjectUrl(12)),
      ]);
    });

    test('POST /projects/:id/duplicate deletes the duplicate when a later step fails', async () => {
      signIn(admin);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockProjectApi({ createdProjectId: 12, bundles: { 1: projectBundle(projetView(1), [taskView(2)], []) } });
      projectApi.on('post', PROJECT.tasks, textError(500, 'database is down'));
      projectApi.on('delete', PROJECT.project, textError(500, 'still down'));

      const response = await as(request(app).post('/projects/project-1/duplicate'), admin).send({});

      expect(response.status).toBe(502);
      expect(projectApi.calls(PROJECT.project, 'DELETE').map((call) => call.url.pathname)).toEqual([projectApiUrls.getDeleteProjectUrl(12)]);
    });

    test('the access guards read the project bundle once per request', async () => {
      signIn(admin);
      mockProjectApi({ createdProjectId: 12, bundles: {
        1: projectBundle(projetView(1), [taskView(2)], [admin]),
        12: projectBundle(projetView(12), [taskView(30)], [admin]),
      } });
      const reads = () => projectApi.calls(PROJECT.project, 'GET').length;

      await as(request(app).get('/projects/project-1'), admin);
      const details = reads();
      await as(request(app).patch('/projects/project-1'), admin).send({ title: 'Voirie' });
      const update = reads() - details;
      expect((await as(request(app).post('/projects/project-1/duplicate'), admin).send({})).status).toBe(201);
      const duplicate = reads() - details - update;
      await as(request(app).delete('/projects/project-1/tasks/task-2'), admin);
      const deleteTask = reads() - details - update - duplicate;

      // details: guard only; update: guard + re-read; duplicate: guard + re-read of the copy; delete: guard only.
      expect({ details, update, duplicate, deleteTask }).toEqual({ details: 1, update: 2, duplicate: 2, deleteTask: 1 });
      expect(userBff.calls(USER_BFF.me, 'get')).toHaveLength(4);
    });

    test.each([
      ['get', '/projects/user-1'],
      ['get', '/projects/abc1'],
      ['get', '/projects/project-1x'],
      ['delete', '/projects/project-1/tasks/project-2'],
      ['get', '/projects/task-1/tasks/task-2/collaboration'],
    ] as const)('%s %s answers 400: ids are parsed with their own prefix only', async (method, url) => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const response = await as(request(app)[method](url), admin);

      expect(response.status).toBe(400);
      expectBffContract(method, url, response);
      expect(upstreamSequence()).toEqual([]);
    });

    test('an unknown task answers 404 from the guard without any write', async () => {
      signIn(admin);
      mockProjectApi({ bundles: { 1: projectBundle(projetView(1), [taskView(2)], [admin]) } });

      const response = await as(request(app).patch('/projects/project-1/tasks/task-9/status'), admin).send({ status: 'done' });

      expect(response.status).toBe(404);
      expectBffContract('patch', '/projects/project-1/tasks/task-9/status', response);
      expect(projectApi.calls(PROJECT.task, 'PATCH')).toHaveLength(0);
    });
  });

  describe('upstream configuration', () => {
    test.each([
      ['USER_BFF', () => userBff.requests],
      ['PROJECT_API', () => projectApi.requests],
      ['CORE_API', () => coreApi.requests],
    ] as const)('answers 503 without any call to %s when its URL is missing (no localhost default)', async (service, received) => {
      signIn(marie);
      mockProjectApi({ projects: [projetView(1)], bundles: { 1: projectBundle(projetView(1), [], [marie]) } });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      delete process.env[`${service}_URL`];
      delete process.env[`${service}_PORT`];

      const response = await as(request(app).get('/projects-page'), marie);

      expect(response.status).toBe(503);
      expectBffContract('get', '/projects-page', response);
      expect(response.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: `The ${service} service is not configured.`, details: [] });
      expect(received()).toEqual([]);
    });

    test('a write route declares and answers 503 when Project API is not configured', async () => {
      signIn(marie);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      delete process.env.PROJECT_API_URL;

      const response = await as(request(app).patch('/projects/project-1/close'), marie).send({ status: 'done' });

      expect(response.status).toBe(503);
      expectBffContract('patch', '/projects/project-1/close', response);
      expect(projectApi.requests).toEqual([]);
    });

    test('a URL carrying its own port wins over <SERVICE>_PORT', async () => {
      signIn(admin);
      mockProjectApi();
      process.env.PROJECT_API_URL = projectApi.url;
      process.env.PROJECT_API_PORT = '1';

      const response = await as(request(app).get('/projects-page'), admin);

      expect(response.status).toBe(200);
      expect(projectApi.requests).toHaveLength(1);
    });
  });

  describe('GET /check_apis', () => {
    beforeEach(() => {
      projectApi.on('get', PROJECT.health, { raw: 'OK', contentType: 'text/plain' });
      coreApi.on('get', CORE.health, { raw: 'OK', contentType: 'text/plain' });
      userBff.on('get', USER_BFF.health, { raw: 'OK', contentType: 'text/plain' });
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    test('reports every upstream connected through its /health operation', async () => {
      // A public probe: the caller's Authorization header is never forwarded upstream.
      const response = await request(app).get('/check_apis').set('Authorization', bearer(admin.id));

      expect(response.status).toBe(200);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'OK', core_api: 'Connected', project_api: 'Connected', user_bff: 'Connected' });
      expect(upstreamSequence()).toEqual([called('GET', projectApiUrls.getHealthUrl())]);
      expect(coreApi.requests.map((call) => call.url.pathname)).toEqual([coreApiUrls.getHealthUrl()]);
      expect(userBff.requests.map((call) => call.url.pathname)).toEqual([userBffUrls.getGetHealthUrl()]);
      expect(mocks.flatMap((mock) => mock.requests).map((call) => call.headers.authorization)).toEqual([undefined, undefined, undefined]);
      expect(response.headers['cache-control']).toBeUndefined();
    });

    test.each([
      ['Project API', () => projectApi.on('get', PROJECT.health, { dropConnection: true }), { core_api: 'Connected', project_api: 'Unreachable', user_bff: 'Connected' }],
      ['Core API', () => coreApi.on('get', CORE.health, { dropConnection: true }), { core_api: 'Unreachable', project_api: 'Connected', user_bff: 'Connected' }],
      ['BFF User', () => userBff.on('get', USER_BFF.health, { status: 503, raw: 'down', contentType: 'text/plain', outOfContract: true }), { core_api: 'Connected', project_api: 'Connected', user_bff: 'Unreachable' }],
    ])('answers 502 when %s is unreachable', async (_service, breakService, expected) => {
      breakService();

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(502);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'Error', ...expected });
    });

    test('reports an unconfigured API as unreachable, probing the same variables as the real calls', async () => {
      delete process.env.PROJECT_API_URL;

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(502);
      expectBffContract('get', '/check_apis', response);
      expect(response.body).toEqual({ status: 'Error', core_api: 'Connected', project_api: 'Unreachable', user_bff: 'Connected' });
      expect(projectApi.requests).toEqual([]);
    });

    test('accepts a PROJECT_API_URL that already carries its port (as the Helm chart sets it)', async () => {
      process.env.PROJECT_API_URL = projectApi.url;
      delete process.env.PROJECT_API_PORT;

      const response = await request(app).get('/check_apis');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'OK', core_api: 'Connected', project_api: 'Connected', user_bff: 'Connected' });
    });
  });
});
