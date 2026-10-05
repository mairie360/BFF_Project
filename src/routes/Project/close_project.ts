import { Router, type Request, type Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, ErrorResponse, CloseProjectBody, ProjectDetailsResponse, ProjectIdParams, registry } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import { buildProjectDtoForUser, buildTaskDtoForUser, fetchProjectBundle, requireProjectIdParam } from './project_helpers';
import { requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, setProjectClosed } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

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
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const body = parseRequest(CloseProjectBody, req.body, 'body');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);

  const { user } = await requireProjectManagement(caller, getProjectUserContext(res), projectId);
  // Both statuses go through PATCH /projects/{project_id}: the close route of Project API cannot suspend.
  await setProjectClosed(caller, projectId, body.status === 'done' ? 'completed' : 'suspended');

  const bundle = await fetchProjectBundle(caller, projectId);
  // The re-read status (Completed → done, Suspended → review) is returned, not the submitted one.
  res.status(200).json({
    project: buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
    taskItems: bundle.tasks.map((task) => buildTaskDtoForUser(user, task, bundle.users)),
  });
});

export default router;
