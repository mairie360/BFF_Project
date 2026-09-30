import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
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

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 404, 500, 502] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}',
  tags: ['Projects'],
  summary: 'Récupère le détail d’un projet',

  request: {
    params: ProjectIdParams,
  },

  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: {
      description: 'Projet trouvé',
      content: {
        'application/json': {
          schema: ProjectDetailsResponse,
        },
      },
    },

    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponse,
        },
      },
    },
  },
});

router.get('/:projectId', async (req: Request, res: Response) => {
  const paramsResult = ProjectIdParams.safeParse(req.params);

  if (!paramsResult.success) {
    return sendValidationError(res, 'params', paramsResult.error.issues);
  }

  const projectId = parsePublicId(paramsResult.data.projectId);

  if (projectId === null) {
    return sendValidationError(res, 'params', [
      {
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
    return handleUnknownError(res, error, ERROR_STATUSES);
  }
});

export default router;
