import { Router, type Request, type Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, ErrorResponse, CloseProjectBody, ProjectDetailsResponse, ProjectIdParams, registry } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import { buildProjectDtoForUser, buildBundleTaskDtos, fetchProjectBundle, requireProjectIdParam } from './project_helpers';
import { requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, setProjectClosed } from '../../services/projectData';

const router = Router();

// Project API status written for each closing status (MAIR-1084).
const CLOSE_STATUS = { done: 'Completed', 'on-hold': 'Suspended', review: 'Review' } as const;

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'patch',
  path: '/projects/{projectId}/close',
  tags: ['Projects'],
  summary: 'Close a project, put it on hold or in review',
  request: {
    params: ProjectIdParams,
    body: { required: true, content: { 'application/json': { schema: CloseProjectBody } } },
  },
  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: { description: 'Project closed or suspended', content: { 'application/json': { schema: ProjectDetailsResponse } } },
    403: { description: 'Insufficient rights', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

router.patch('/:projectId/close', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const body = parseRequest(CloseProjectBody, req.body, 'body');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);

  const { user } = await requireProjectManagement(caller, getProjectUserContext(res), projectId);
  // `done` goes through the close route of Project API (idempotent), the others through PATCH /projects/{project_id}.
  await setProjectClosed(caller, projectId, CLOSE_STATUS[body.status]);

  const bundle = await fetchProjectBundle(caller, projectId);
  // The re-read status (Completed → done, Suspended → on-hold, Review → review) is returned, not the submitted one.
  res.status(200).json({
    project: buildProjectDtoForUser(user, bundle),
    taskItems: buildBundleTaskDtos(user, bundle),
  });
});

export default router;
