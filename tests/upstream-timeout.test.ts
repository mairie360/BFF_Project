import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type * as BffsLib from '@mairie360/bffs-lib';
import request from 'supertest';
import app from '../src/app';
import { UPSTREAM_SERVICES as UPSTREAMS } from '../src/index';
import { eddsaToken, useSessionPublicKey } from './support/session-keys';

// MAIR-538: an upstream that accepts the connection and never answers. The BFF must stop waiting on its own
// timeout (axios `ECONNABORTED`) and answer 502 in the shared envelope, instead of hanging the caller. The lib
// builds every upstream call with a 10 s timeout: the wrapper below only shortens it so the test stays fast; the
// mapping from the timeout to the 502 is the real code path.
const SHORT_TIMEOUT_MS = 150;

jest.mock('@mairie360/bffs-lib', () => {
  const actual = jest.requireActual<typeof BffsLib>('@mairie360/bffs-lib');
  return {
    ...actual,
    asCaller: (service: string, req: Parameters<typeof actual.asCaller>[1]) => actual.asCaller(service, req, 150),
    withoutSession: (service: string) => actual.withoutSession(service, 150),
  };
});

/** A session-bound read of this BFF that calls an upstream (same route as tests/mair-680-eddsa-session.test.ts). */
const ROUTE = '/projects-page';

let blackHole: Server;
let received = 0;

beforeAll(async () => {
  blackHole = createServer(() => {
    received += 1; // never answered
  });
  await new Promise<void>((resolve) => blackHole.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(blackHole.address() as AddressInfo).port}`;
  for (const service of UPSTREAMS) {
    process.env[`${service}_URL`] = url;
    delete process.env[`${service}_PORT`];
  }
});

afterAll(async () => {
  blackHole.closeAllConnections();
  await new Promise((resolve) => blackHole.close(resolve));
});

beforeEach(() => {
  received = 0;
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  useSessionPublicKey();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MAIR-538 upstream timeout', () => {
  it('answers 502 in the error envelope once the upstream is too slow, and never leaks the timeout detail', async () => {
    const startedAt = Date.now();
    const response = await request(app).get(ROUTE).set('Authorization', `Bearer ${eddsaToken(1)}`);
    const elapsed = Date.now() - startedAt;

    expect(received).toBeGreaterThan(0);
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: { code: 'BAD_GATEWAY', message: expect.stringMatching(/service is unavailable\.$/), details: [] } });
    expect(JSON.stringify(response.body)).not.toMatch(/timeout of|ECONNABORTED|127\.0\.0\.1/);
    expect(elapsed).toBeGreaterThanOrEqual(SHORT_TIMEOUT_MS - 20);
    expect(elapsed).toBeLessThan(5000);
  });

  it('stays reachable for the other routes while an upstream hangs (the timeout frees the request)', async () => {
    const [slow, health] = await Promise.all([
      request(app).get(ROUTE).set('Authorization', `Bearer ${eddsaToken(1)}`),
      request(app).get('/health'),
    ]);

    expect(slow.status).toBe(502);
    expect(health.status).toBe(200);
  });
});
