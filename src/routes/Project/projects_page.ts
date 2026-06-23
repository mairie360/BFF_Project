import { Router, Request, Response } from 'express';
import {
  registry,
  ProjectsPageResponse,
  ProjectsPageQuery,
  ApiError,
} from '../../openapi-registry';

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/projects-page',
  tags: ['Projects'],
  summary: 'Charge la page projets',
  description:
    'Retourne les projets, les filtres, les options et les données Kanban nécessaires à l’affichage de la page.',

  request: {
    query: ProjectsPageQuery,
  },

  responses: {
    200: {
      description: 'Page projets chargée avec succès',
      content: {
        'application/json': {
          schema: ProjectsPageResponse,
        },
      },
    },

    500: {
      description: 'Erreur serveur',
      content: {
        'application/json': {
          schema: ApiError,
        },
      },
    },
  },
});

router.get('/', (req: Request, res: Response) => {
  res.status(501).json({
    error: 'Not implemented',
  });
});

export default router;
