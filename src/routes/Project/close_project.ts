import { Router, type Request, type Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, ErrorResponse, CloseProjectBody, ProjectDetailsResponse, ProjectIdParams, registry } from '../../openapi-registry';
import {
  buildProjectDtoForUser,
  buildTaskDtoForUser,
  fetchProjectBundle,
  handleUnknownError,
  parsePublicId,
  sendValidationError,
} from './project_helpers';
import { requireProjectManagement } from './project_access';
import { setProjectClosed } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'patch',
  path: '/projects/{projectId}/close',
  tags: ['Projects'],
  summary: 'Clôture ou suspend un projet',
  request: {
    params: ProjectIdParams,
    body: { required: true, content: { 'application/json': { schema: CloseProjectBody } } },
  },
  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: { description: 'Projet clôturé ou suspendu', content: { 'application/json': { schema: ProjectDetailsResponse } } },
    403: { description: 'Insufficient rights', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

router.patch('/:projectId/close', async (req: Request, res: Response) => {
  const paramsResult = ProjectIdParams.safeParse(req.params);
  const bodyResult = CloseProjectBody.safeParse(req.body);
  if (!paramsResult.success) return sendValidationError(res, 'params', paramsResult.error.issues);
  if (!bodyResult.success) return sendValidationError(res, 'body', bodyResult.error.issues);

  const projectId = parsePublicId(paramsResult.data.projectId);
  if (projectId === null) return sendValidationError(res, 'params', [{ path: ['projectId'], message: 'projectId must end with a numeric identifier' }]);

  try {
    const user = await requireProjectManagement(res, projectId);
    if (!user) return;
    // Project_API ne sait que clôturer (PATCH /projects/{project_id}/close, sans suspension) et ne permet pas de
    await setProjectClosed(projectId, bodyResult.data.status === 'done' ? 'completed' : 'suspended');

    const bundle = await fetchProjectBundle(projectId);
    const baseProject = await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users);
    return res.status(200).json({
      project: {
        ...baseProject,
        status: bodyResult.data.status,
        statusLabel: bodyResult.data.status === 'done' ? 'Terminé' : 'En revue',
      },
      taskItems: await Promise.all(bundle.tasks.map((task) =>
        buildTaskDtoForUser(user, projectId, task, bundle.users),
      )),
    });
  } catch (error) {
    return handleUnknownError(res, error, ERROR_STATUSES);
  }
});

export default router;
