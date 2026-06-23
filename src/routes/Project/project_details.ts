import { Router, Request, Response } from 'express';
import {
  registry,
  ProjectIdParams,
  ProjectDetailsResponse,
  ApiError,
} from '../../openapi-registry';

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}',
  tags: ['Projects'],
  summary: 'Récupère le détail d’un projet',

  request: {
    params: ProjectIdParams,
  },

  responses: {
    200: {
      description: 'Projet trouvé',
      content: {
        'application/json': {
          schema: ProjectDetailsResponse,
        },
      },
    },

    404: {
      description: 'Projet introuvable',
      content: {
        'application/json': {
          schema: ApiError,
        },
      },
    },
  },
});

router.get('/:projectId', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented',
  });
});

export default router;

