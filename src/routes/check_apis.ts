import { Router } from 'express';
import projectClient from '../clients/projectClient';
import { checkCoreApi } from '../clients/coreDirectory';
import { CheckApiResponse, CheckApiResponseSchema } from '../views/check_api_view';
import { registry } from '../openapi-registry';
import dotenv from 'dotenv';
dotenv.config();


const router = Router();

registry.registerPath({
  method: 'get',
  path: '/check_apis',
  security: [],
  tags: ['Connectivity'],
  summary: "Vérifie la connexion avec l'API Core et Project (Rust)",
  responses: {
    200: {
      description: 'Connexion réussie',
      content: {
        'application/json': {
          schema: CheckApiResponseSchema,
        },
      },
    },
    502: {
      description: 'API Core injoignable ou API Project injoignable',
      content: {
        'application/json': {
          schema: CheckApiResponseSchema,
        },
      },
    },
  },
});

// Each API is probed through the /health operation of its contract. The Project API address is read on
// every call: the configuration may change without reloading the module.
async function isReachable(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

/**
 * Base URL of Project API from PROJECT_API_URL (host or URL, with or without a port) and PROJECT_API_PORT,
 * which only applies when the URL has no port of its own (e.g. `http://project-api:3001` from the chart).
 */
export function projectApiHealthBaseUrl(
  host = process.env.PROJECT_API_URL,
  port = process.env.PROJECT_API_PORT,
): string {
  if (!host?.trim()) throw new Error('PROJECT_API_URL is not configured');
  const trimmed = host.trim();
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (!url.port && port?.trim()) url.port = port.trim();
  return url.toString().replace(/\/+$/, '');
}

router.get('/', async (_, res) => {
  // Both APIs are probed independently: one failing does not hide the state of the other, and no network
  // detail is returned to the client.
  const [coreReachable, projectReachable] = await Promise.all([
    isReachable(checkCoreApi),
    isReachable(async () => projectClient.health({ baseURL: projectApiHealthBaseUrl(), timeout: 5_000 })),
  ]);
  const result: CheckApiResponse = {
    status: coreReachable && projectReachable ? 'OK' : 'Error',
    core_api: coreReachable ? 'Connected' : 'Unreachable',
    project_api: projectReachable ? 'Connected' : 'Unreachable',
  };

  res.status(coreReachable && projectReachable ? 200 : 502).json(result);
});

export default router;
