import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
import {
  buildProjectDtoForUser,
  buildTaskDtoForUser,
  fetchProjectBundle,
  handleUnknownError,
  parsePublicId,
  sendValidationError,
} from './project_helpers';
import { requireProjectView } from './project_access';

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
    const user = await requireProjectView(res, projectId);
    if (!user) return;
    const bundle = await fetchProjectBundle(projectId);
    const taskItems = (await Promise.all(
      bundle.tasks.map(async (task) => buildTaskDtoForUser(user, projectId, task, bundle.users)),
    )).filter((task) => task.permissions.canView);

    return res.status(200).json({
      project: await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
      taskItems,
    });
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

export default router;
