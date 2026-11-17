import request from 'supertest';
import app from '../src/app';
import { eddsaToken, useSessionPublicKey } from './support/session-keys';

// MAIR-538: `express.json()` keeps its default 100 kb limit. A larger body must end in the shared envelope with
// status 413 `PAYLOAD_TOO_LARGE`, not in a 500 and not in an HTML page, whether the caller is signed in or not.
const tooLarge = () => JSON.stringify({ blob: 'x'.repeat(200 * 1024) });

beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  useSessionPublicKey();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MAIR-538 body above the JSON limit', () => {
  it('answers 413 PAYLOAD_TOO_LARGE in the error envelope', async () => {
    const response = await request(app).post('/projects-page').set('Content-Type', 'application/json').send(tooLarge());

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', details: [] } });
  });

  it('answers 413 for a signed-in caller too, and reports nothing as a server error', async () => {
    const stdout = jest.spyOn(process.stdout, 'write');
    const response = await request(app)
      .post('/projects-page')
      .set('Authorization', `Bearer ${eddsaToken(1)}`)
      .set('Content-Type', 'application/json')
      .send(tooLarge());

    expect(response.status).toBe(413);
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('request failed');
  });

  it('keeps accepting a body under the limit (parsed, then refused by the route as usual)', async () => {
    const response = await request(app)
      .post('/projects-page')
      .set('Authorization', `Bearer ${eddsaToken(1)}`)
      .send({ blob: 'x'.repeat(1024) });

    expect(response.status).not.toBe(413);
  });
});
