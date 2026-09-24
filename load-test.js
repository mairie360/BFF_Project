import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { createCoverage } from '/coverage.js';

// ---------------------------------------------------------------------------
// k6 load test of the BFF Project.
//
// Every operation of the contract (contracts/openapi.json, mounted as /openapi.json) has one
// handler below: the shared OpenAPI coverage module (mairie360/CICD tests/k6/coverage.js, see
// performance_test.sh) aborts at init when an operation has no handler, and fails the
// `operations_uncovered` threshold when a handler ends without sending its request. Adding a route
// to the BFF therefore means adding its handler here.
//
// Two scenarios share the handlers:
// - `crud` (2 VUs): `coverage.run()` calls every handler once per iteration, reads and writes, so
//   it carries the coverage gate. Handlers run path by path in contract order and, for one path,
//   in the order get, put, post, delete, options, head, patch, trace, so `PATCH .../close` runs
//   before `POST /projects`. `prepare()` therefore creates the working project (with one task)
//   before the handlers run; the POST handlers create the disposable project and task that the
//   DELETE handlers remove, and `cleanup()` deletes the working project and its duplicate.
// - `reads` (up to 20 VUs): replays only the GET handlers, which read the fixtures seeded by
//   init-test.sql (project-1, task-1) and never depend on `state`.
// Every operation gets a p(95) threshold, whose budget depends on its family (`budgetOf`).
// ---------------------------------------------------------------------------

// Must match the JWT_SECRET of the core-api / project-api / bff-user services of the test stack.
const JWT_SECRET = __ENV.JWT_SECRET || 'b"secret"';
// User role only, seeded by init-test.sql: member of project-1.
const USER_ID = __ENV.PERF_USER_ID || '2';
// Admin role, seeded by init-test.sql: every write (only Admin/Maire/Responsable manage projects).
const ADMIN_ID = __ENV.PERF_ADMIN_ID || '1';
// Fixtures seeded by init-test.sql.
const FIXTURE_PROJECT_ID = 'project-1';
const FIXTURE_TASK_ID = 'task-1';
const DUE_DATE = '2030-12-31T00:00:00Z';

// State of the current `crud` iteration (module scope is per VU in k6).
let state = {};

function b64url(value) {
  return encoding.b64encode(value, 'rawurl');
}

// Minimal HS256 JWT accepted by Core API / BFF User (sub + role + exp claims).
function mintJwt(sub, role) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, role, exp: now + 3600 }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.hmac('sha256', JWT_SECRET, signingInput, 'base64rawurl');
  return `${signingInput}.${signature}`;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function unique(prefix) {
  return `${prefix} ${__VU}-${__ITER}-${Date.now()}`;
}

function need(value, what) {
  if (value === undefined || value === null) {
    throw new Error(`${what} is missing, an earlier step of this iteration failed`);
  }
  return value;
}

function json(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

function projectBody(title) {
  return {
    title,
    description: 'Project created by the k6 load test',
    status: 'todo',
    priority: 'medium',
    responsibleId: `user-${ADMIN_ID}`,
    assigneeIds: [`user-${ADMIN_ID}`],
    labels: ['perf'],
    dueDate: DUE_DATE,
  };
}

function taskBody(title) {
  return {
    title,
    status: 'todo',
    priority: 'low',
    responsibleId: `user-${ADMIN_ID}`,
    assigneeIds: [`user-${ADMIN_ID}`],
    labels: ['perf'],
    dueDate: DUE_DATE,
  };
}

const handlers = {
  // --- Connectivity (public) ---
  'GET /health': ({ request }) =>
    check(request(), { 'health 200': (r) => r.status === 200 }),
  'GET /check_apis': ({ request }) =>
    check(request(), { 'check_apis 200': (r) => r.status === 200 }),

  // --- Projects (writes as admin: only Admin/Maire/Responsable manage projects) ---
  'PATCH /projects/{projectId}/close': ({ request, data }) =>
    check(request({ path: { projectId: need(state.projectId, 'working project') }, body: { status: 'done' }, headers: data.admin }), {
      'close project 200': (r) => r.status === 200,
    }),
  // Disposable project, removed by DELETE /projects/{projectId}.
  'POST /projects': ({ request, data }) => {
    const res = request({ body: projectBody(unique('k6 disposable project')), headers: data.admin });
    check(res, { 'create project 201': (r) => r.status === 201 });
    state.disposableProjectId = ((json(res) || {}).project || {}).id;
  },
  // Disposable task of the working project, removed by DELETE /projects/{projectId}/tasks/{taskId}.
  'POST /projects/{projectId}/tasks': ({ request, data }) => {
    const res = request({
      path: { projectId: need(state.projectId, 'working project') },
      body: taskBody(unique('k6 disposable task')),
      headers: data.admin,
    });
    check(res, { 'create task 201': (r) => r.status === 201 });
    state.disposableTaskId = (json(res) || {}).id;
  },
  'GET /projects/{projectId}': ({ request }) =>
    check(request({ path: { projectId: FIXTURE_PROJECT_ID } }), { 'project 200': (r) => r.status === 200 }),
  'DELETE /projects/{projectId}': ({ request, data }) =>
    check(request({ path: { projectId: need(state.disposableProjectId, 'disposable project') }, headers: data.admin }), {
      'delete project 204': (r) => r.status === 204,
    }),
  'PATCH /projects/{projectId}': ({ request, data }) =>
    check(
      request({
        path: { projectId: need(state.projectId, 'working project') },
        body: { title: unique('k6 patched project'), priority: 'high' },
        headers: data.admin,
      }),
      { 'patch project 200': (r) => r.status === 200 },
    ),
  'DELETE /projects/{projectId}/tasks/{taskId}': ({ request, data }) =>
    check(
      request({
        path: { projectId: need(state.projectId, 'working project'), taskId: need(state.disposableTaskId, 'disposable task') },
        headers: data.admin,
      }),
      { 'delete task 204': (r) => r.status === 204 },
    ),
  'PATCH /projects/{projectId}/tasks/{taskId}': ({ request, data }) =>
    check(
      request({
        path: { projectId: need(state.projectId, 'working project'), taskId: need(state.taskId, 'working task') },
        body: { title: unique('k6 patched task'), priority: 'high' },
        headers: data.admin,
      }),
      { 'patch task 200': (r) => r.status === 200 },
    ),
  // The duplicate is deleted by cleanup().
  'POST /projects/{projectId}/duplicate': ({ request, data }) => {
    const res = request({ path: { projectId: need(state.projectId, 'working project') }, headers: data.admin });
    check(res, { 'duplicate project 201': (r) => r.status === 201 });
    state.duplicateProjectId = ((json(res) || {}).project || {}).id;
  },
  'PATCH /projects/{projectId}/tasks/{taskId}/status': ({ request, data }) =>
    check(
      request({
        path: { projectId: need(state.projectId, 'working project'), taskId: need(state.taskId, 'working task') },
        body: { status: 'in-progress' },
        headers: data.admin,
      }),
      { 'task status 200': (r) => r.status === 200 },
    ),
  'GET /projects-page': ({ request }) =>
    check(request({ query: { view: 'kanban', page: 1, limit: 20 } }), { 'projects-page 200': (r) => r.status === 200 }),
  // Admin token: user 2 is a member of project-1 but Project API only shows a task's
  // collaboration to its assignees and to the global roles.
  'GET /projects/{projectId}/tasks/{taskId}/collaboration': ({ request, data }) =>
    check(request({ path: { projectId: FIXTURE_PROJECT_ID, taskId: FIXTURE_TASK_ID }, headers: data.admin }), {
      'collaboration 200': (r) => r.status === 200,
    }),
  'POST /projects/{projectId}/tasks/{taskId}/comments': ({ request, data }) =>
    check(
      request({
        path: { projectId: need(state.projectId, 'working project'), taskId: need(state.taskId, 'working task') },
        body: { message: 'Comment posted by the k6 load test' },
        headers: data.admin,
      }),
      { 'comment 201': (r) => r.status === 201 },
    ),
};

const coverage = createCoverage(handlers);
const readOperations = coverage.operations.filter((o) => o.method === 'GET');

// Creates the working project (with one task) of a `crud` iteration. The created tasks come back
// in the top-level `taskItems` of the answer.
function prepare(data) {
  const body = projectBody(unique('k6 working project'));
  body.taskItems = [taskBody(unique('k6 working task'))];
  const res = http.post(coverage.url('POST /projects'), JSON.stringify(body), {
    headers: Object.assign({ 'Content-Type': 'application/json' }, data.admin),
    tags: { op: 'POST /projects' },
  });
  const created = json(res) || {};
  state.projectId = (created.project || {}).id;
  state.taskId = ((created.taskItems || [])[0] || {}).id;
}

// Deletes the working project and its duplicate (their tasks go with them).
function cleanup(data) {
  for (const projectId of [state.projectId, state.duplicateProjectId]) {
    if (!projectId) continue;
    http.del(coverage.url('DELETE /projects/{projectId}', { projectId }), null, {
      headers: data.admin,
      tags: { op: 'DELETE /projects/{projectId}' },
    });
  }
}

// p(95) budget of an operation, per family.
function budgetOf({ op, method }) {
  if (op === 'GET /health') return 50; // process probe
  if (op === 'GET /check_apis') return 300; // -> Core + Project /health
  if (method === 'GET') return 500; // BFF User /me + Project API reads
  return 800; // writes: BFF User /me + Project API writes + re-read of the bundle
}

const perOperationThresholds = {};
for (const operation of coverage.operations) {
  perOperationThresholds[`http_req_duration{op:${operation.op}}`] = [`p(95)<${budgetOf(operation)}`];
}

export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-vus',
      exec: 'reads',
      stages: [
        { duration: '30s', target: 20 }, // ramp-up
        { duration: '1m', target: 20 }, // steady load
        { duration: '10s', target: 0 }, // ramp-down
      ],
    },
    crud: {
      executor: 'constant-vus',
      exec: 'crud',
      vus: 2,
      duration: '1m40s',
    },
  },
  thresholds: {
    ...coverage.thresholds,
    ...perOperationThresholds,
    http_req_failed: ['rate<0.01'], // < 1% errors
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return { user: bearer(mintJwt(USER_ID, 'user')), admin: bearer(mintJwt(ADMIN_ID, 'admin')) };
}

// Every GET handler, with a plain request() (no coverage accounting: `crud` owns the gate).
export function reads(data) {
  for (const operation of readOperations) {
    const request = (call = {}) =>
      http.get(coverage.url(operation.op, call.path, call.query), {
        headers: Object.assign({}, data.user, call.headers),
        tags: { op: operation.op },
      });
    handlers[operation.op]({ request, data, op: operation.op, method: operation.method, path: operation.path });
  }
  sleep(1);
}

export function crud(data) {
  state = {};
  prepare(data);
  // User token by default; the write handlers pass the admin one.
  coverage.run({ headers: data.user, data });
  cleanup(data);
  sleep(1);
}
