import { Router } from 'express';
import axios from 'axios';
import { CheckApiResponse, CheckApiResponseSchema } from '../views/check_api_view';
import { registry } from '../openapi-registry';

const router = Router();

const CORE_FULL_URL = `http://${process.env.CORE_API_URL}:${process.env.CORE_API_PORT}`;
const PROJECT_FULL_URL = `http://${process.env.PROJECT_API_URL}:${process.env.PROJECT_API_PORT}`;

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
      description: 'API Core injoignable',
    },
  },
});

router.get('/', async (_, res) => {
  try {
    const coreResponse = await axios.get(`${CORE_FULL_URL}/health`, { timeout: 5000 });
    console.log(coreResponse);
    const core_is_reachable = coreResponse.status === 200;
    
    const projectResponse = await axios.get(`${PROJECT_FULL_URL}/health`, { timeout: 5000 });
    console.log(projectResponse);
    const project_is_reachable = projectResponse.status === 200;
    const result: CheckApiResponse = {
      status: 'OK',
      core_api: core_is_reachable ? 'Connected' : 'Unreachable',
      project_api: project_is_reachable ? 'Connected' : 'Unreachable'
    };
    res.status(200).json(result);
  } catch (error) {
    res.status(502).json({
      status: 'Error',
      core_api: 'Unreachable',
      project_api: 'Unreachable',
      message: (error as Error).message
    });
  }
});

export default router;