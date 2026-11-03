import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import app from '../src/app';
import { UPSTREAM_SERVICES, assertStartupConfiguration } from '../src/index';
import { captureLogs } from './support/logs';
import { JWT_PUBLIC_KEY, eddsaToken, foreignKeyPair, hs256Token, useSessionPublicKey } from './support/session-keys';

// MAIR-680 (audit A1): Core is the only signer of the session JWTs (Ed25519, EdDSA). The BFF verifies them with
// Core's public key (`JWT_PUBLIC_KEY`) and no longer needs the shared `JWT_SECRET`: once it is removed, a token
// signed with any HMAC secret (the historical HS256 tokens, or one forged by a compromised service) is refused.

/** A session-bound route of this BFF (bffs-lib requireSession). */
const ROUTE = '/projects-page';
const TRANSITION_SECRET = 'mair-680-transition-secret-of-the-tests';

// Stands for every upstream: counts the calls and fails them, so a token that passes the session check ends in a
// 5xx (or a 4xx on its parameters), never a 401.
let upstreamCalls = 0;
let upstream: Server;

beforeAll(async () => {
  upstream = createServer((_req, res) => {
    upstreamCalls += 1;
    res.writeHead(500).end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  for (const service of UPSTREAM_SERVICES) {
    process.env[`${service}_URL`] = url;
    delete process.env[`${service}_PORT`];
  }
});

afterAll(async () => {
  useSessionPublicKey();
  await new Promise((resolve) => upstream.close(resolve));
});

beforeEach(() => {
  upstreamCalls = 0;
  captureLogs();
  useSessionPublicKey();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MAIR-680 startup with the session public key', () => {
  it('MAIR-680 starts with JWT_PUBLIC_KEY alone, without JWT_SECRET', () => {
    expect(process.env.JWT_SECRET).toBeUndefined();

    expect(() => assertStartupConfiguration()).not.toThrow();
  });

  it('MAIR-680 refuses to start without JWT_PUBLIC_KEY nor JWT_SECRET', () => {
    delete process.env.JWT_PUBLIC_KEY;

    expect(() => assertStartupConfiguration()).toThrow('Missing configuration: JWT_PUBLIC_KEY');
  });

  it('MAIR-680 refuses to start with a malformed JWT_PUBLIC_KEY', () => {
    process.env.JWT_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----';

    expect(() => assertStartupConfiguration()).toThrow('Invalid configuration: JWT_PUBLIC_KEY');
  });

  it('MAIR-680 accepts the key with escaped line breaks, as environment files hold it', () => {
    process.env.JWT_PUBLIC_KEY = JWT_PUBLIC_KEY.trim().replace(/\n/g, '\\n');

    expect(() => assertStartupConfiguration()).not.toThrow();
  });
});

describe(`MAIR-680 session tokens on GET ${ROUTE}`, () => {
  it('MAIR-680 accepts an EdDSA token signed with Core\'s key and calls the upstreams with it', async () => {
    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${eddsaToken(1, { claims: { role: 'admin' } })}`);

    expect(response.status).not.toBe(401);
    expect(upstreamCalls).toBeGreaterThan(0);
  });

  it('MAIR-680 refuses an HS256 token with 401 when JWT_SECRET is unset, without calling an upstream', async () => {
    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${hs256Token(1, TRANSITION_SECRET)}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String), details: [] } });
    expect(upstreamCalls).toBe(0);
  });

  it('MAIR-680 refuses an EdDSA token signed with another key under Core\'s kid', async () => {
    const forged = eddsaToken(1, { privateKey: foreignKeyPair.privateKey });

    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
    expect(upstreamCalls).toBe(0);
  });

  it('MAIR-680 still accepts an HS256 token while JWT_SECRET is set (transition)', async () => {
    process.env.JWT_SECRET = TRANSITION_SECRET;

    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${hs256Token(1, TRANSITION_SECRET)}`);

    expect(response.status).not.toBe(401);
    expect(upstreamCalls).toBeGreaterThan(0);
  });

  it('MAIR-680 answers 503 without calling an upstream when no session key is configured', async () => {
    delete process.env.JWT_PUBLIC_KEY;

    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${eddsaToken(1)}`);

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toMatch(/JWT_(PUBLIC_KEY|SECRET)/);
    expect(upstreamCalls).toBe(0);
  });

  it('MAIR-680 answers 503 without calling an upstream when JWT_PUBLIC_KEY is malformed', async () => {
    process.env.JWT_PUBLIC_KEY = 'not a PEM key';

    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${eddsaToken(1)}`);

    expect(response.status).toBe(503);
    expect(upstreamCalls).toBe(0);
  });
});
