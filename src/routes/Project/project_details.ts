import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import { buildProjectDtoForUser, buildTaskDtoForUser, requireProjectIdParam } from './project_helpers';
import { requireProjectView } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

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
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);

  const { user, bundle } = await requireProjectView(caller, getProjectUserContext(res), projectId);
  const taskItems = bundle.tasks
    .map((task) => buildTaskDtoForUser(user, task, bundle.users))
    .filter((task) => task.permissions.canView);

  res.status(200).json({
    project: buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
    taskItems,
  });
});

export default router;
