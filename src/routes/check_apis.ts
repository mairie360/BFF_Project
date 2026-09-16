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

// Chaque API est sondée par l'opération /health de son contrat. L'URL de Project API est relue à chaque
// appel : la configuration peut changer sans recharger le module.
async function isReachable(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}

function projectApiHealthOptions() {
  const host = process.env.PROJECT_API_URL;
  const port = process.env.PROJECT_API_PORT;
  if (!host || !port) throw new Error('PROJECT_API non configurée');

  const baseUrl = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return { baseURL: `${baseUrl.replace(/\/+$/, '')}:${port}`, timeout: 5_000 };
}

router.get('/', async (_, res) => {
  // Les deux API sont sondées indépendamment : une panne de l'une ne masque pas l'état de l'autre,
  // et aucun détail réseau n'est renvoyé au client.
  const [coreReachable, projectReachable] = await Promise.all([
    isReachable(checkCoreApi),
    isReachable(async () => projectClient.health(projectApiHealthOptions())),
  ]);
  const result: CheckApiResponse = {
    status: coreReachable && projectReachable ? 'OK' : 'Error',
    core_api: coreReachable ? 'Connected' : 'Unreachable',
    project_api: projectReachable ? 'Connected' : 'Unreachable',
  };

  res.status(coreReachable && projectReachable ? 200 : 502).json(result);
});

export default router;
