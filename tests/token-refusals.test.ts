import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import request from 'supertest';
import app from '../src/app';
import { JWT_SECRET, sessionToken } from './support/project-fixtures';

// Token refusals on every secured operation of the published contract (MAIR-474): an operation is covered as
// soon as it is documented. Each forged token must get its 401 from the BFF itself, before any upstream call;
// a genuine token of the same shape (positive control) must get past that check, so the 401s come from the
// token alone.

type Operation = { security?: unknown[] };
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const contract = JSON.parse(readFileSync(join(__dirname, '..', 'contracts', 'openapi.json'), 'utf8')) as {
    security: unknown[];
    paths: Record<string, Record<string, Operation>>;
};

// Public on purpose: the probes.
const PUBLIC_OPERATIONS = ['GET /health', 'GET /check_apis'];

const operations = Object.entries(contract.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
        method: method as Method,
        label: `${method.toUpperCase()} ${path}`,
        uri: path.replace(/\{[^}]+\}/g, '7'),
        secured: (operation.security ?? contract.security).length > 0,
    })));
const secured = operations.filter((operation) => operation.secured);

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function signed(payload: object): string {
    const unsigned = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}`;
    return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`;
}
const genuine = sessionToken(1);
const [genuineHeader, , genuineSignature] = genuine.split('.');
const forgedHeaders: Array<[string, string]> = [
    ['another scheme', `Basic ${genuine}`],
    ['a token without scheme', genuine],
    ['an empty bearer', 'Bearer '],
    ['garbage', 'Bearer not.a.jwt'],
    ['another secret', `Bearer ${sessionToken(1, 'not-the-secret-of-this-deployment-0123')}`],
    ['an expired token', `Bearer ${sessionToken(1, JWT_SECRET, -60)}`],
    ['alg none', `Bearer ${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: '1', exp: 4_102_444_800 })}.`],
    ['a payload swapped under a valid signature', `Bearer ${genuineHeader}.${base64url({ sub: '2', exp: 4_102_444_800 })}.${genuineSignature}`],
    ['an asymmetric algorithm', `Bearer ${base64url({ alg: 'RS256', typ: 'JWT' })}.${genuine.split('.')[1]}.${genuineSignature}`],
    ['a well-signed token with a non-numeric subject', `Bearer ${signed({ sub: 'admin', exp: 4_102_444_800 })}`],
];

// Stands for BFF User, Project API and Core API: counts the calls and fails them all, so a genuine token ends
// in a 502 (or a 400 on its parameters), never a 401.
let coreCalls = 0;
let core: Server;

beforeAll(async () => {
    core = createServer((_req, res) => {
        coreCalls += 1;
        res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => core.listen(0, '127.0.0.1', resolve));
    const upstream = `http://127.0.0.1:${(core.address() as AddressInfo).port}`;
    for (const service of ['USER_BFF', 'PROJECT_API', 'CORE_API']) {
      process.env[`${service}_URL`] = upstream;
      delete process.env[`${service}_PORT`];
    }
    process.env.JWT_SECRET = JWT_SECRET;
});

afterAll(async () => {
    await new Promise((resolve) => core.close(resolve));
});

beforeEach(() => {
    coreCalls = 0;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('token refusals of the contract operations', () => {
    it('only leaves the pinned operations public', () => {
        expect(operations.filter((operation) => !operation.secured).map((operation) => operation.label).sort())
            .toEqual([...PUBLIC_OPERATIONS].sort());
        expect(secured.length).toBeGreaterThanOrEqual(10);
    });

    it.each(secured.map((operation) => [operation.label, operation] as const))(
        '%s refuses a missing or forged token with 401, without calling an upstream',
        async (_label, { method, uri }) => {
            for (const [name, authorization] of [['no token', undefined] as const, ...forgedHeaders]) {
                const call = request(app)[method](uri).send({});
                const response = await (authorization === undefined ? call : call.set('Authorization', authorization));

                expect({ name, status: response.status }).toEqual({ name, status: 401 });
            }
            expect(coreCalls).toBe(0);
        },
    );

    it.each(secured.map((operation) => [operation.label, operation] as const))(
        '%s lets a genuine token through the session check (control)',
        async (_label, { method, uri }) => {
            const response = await request(app)[method](uri).set('Authorization', `Bearer ${genuine}`).send({});

            expect(response.status).not.toBe(401);
        },
    );
});
