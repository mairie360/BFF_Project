import { Router, Request, Response } from 'express';
import {
  registry,
  CreateProjectBody,
  ProjectDetailsResponse,
  ApiError,
} from '../../openapi-registry';

const router = Router();

registry.registerPath({
  method: 'post',
  path: '/projects',
  tags: ['Projects'],
  summary: 'Créer un projet',

  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CreateProjectBody,
        },
      },
    },
  },

  responses: {
    201: {
      description: 'Projet créé',
      content: {
        'application/json': {
          schema: ProjectDetailsResponse,
        },
      },
    },

    400: {
      description: 'Erreur de validation',
      content: {
        'application/json': {
          schema: ApiError,
        },
      },
    },
  },
});

router.post('/', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented',
  });
});

export default router;

