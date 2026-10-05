import { baseUrl } from '@mairie360/bffs-lib';
import { Router } from 'express';
import projectClient from '../clients/projectClient';
import { checkCoreApi } from '../clients/coreDirectory';
import { CheckApiResponse, CheckApiResponseSchema } from '../views/check_api_view';
import { registry } from '../openapi-registry';


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

// Each API is probed through the /health operation of its contract, at the same address as the real calls
// (`<SERVICE>_URL` + `<SERVICE>_PORT`, read on every call).
async function isReachable(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

router.get('/', async (_, res) => {
  // Both APIs are probed independently: one failing does not hide the state of the other, and no network
  // detail is returned to the client.
  const [coreReachable, projectReachable] = await Promise.all([
    isReachable(checkCoreApi),
    isReachable(async () => projectClient.health({ baseURL: baseUrl('PROJECT_API'), timeout: 5_000 })),
  ]);
  const result: CheckApiResponse = {
    status: coreReachable && projectReachable ? 'OK' : 'Error',
    core_api: coreReachable ? 'Connected' : 'Unreachable',
    project_api: projectReachable ? 'Connected' : 'Unreachable',
  };

  res.status(coreReachable && projectReachable ? 200 : 502).json(result);
});

export default router;
