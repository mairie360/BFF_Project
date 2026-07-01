import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
import {
  buildProjectResponseFromState,
  fetchProjectBundle,
  handleUnknownError,
  parsePublicId,
  sendValidationError,
} from './project_helpers';

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

router.get('/:projectId', async (req: Request, res: Response) => {
  const paramsResult = ProjectIdParams.safeParse(req.params);

  if (!paramsResult.success) {
    return sendValidationError(res, paramsResult.error.issues);
  }

  const projectId = parsePublicId(paramsResult.data.projectId);

  if (projectId === null) {
    return sendValidationError(res, [
      {
        code: 'invalid_format',
        path: ['projectId'],
        message: 'projectId must end with a numeric identifier',
      },
    ]);
  }

  try {
    const bundle = await fetchProjectBundle(projectId);

    return res.status(200).json(
      buildProjectResponseFromState({
        project: bundle.project,
        tasks: bundle.tasks,
        users: bundle.users,
      }),
    );
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

export default router;

