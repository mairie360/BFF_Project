import { Router, type Request, type Response } from 'express';
import { parseRequest } from '@mairie360/bffs-lib';
import {
  AddProjectMemberBody,
  apiErrorResponses,
  type ApiErrorStatus,
  DeletedProjectMemberParams,
  ProjectIdParams,
  ProjectMemberParams,
  ProjectMembers,
  registry,
  UpdateProjectMemberBody,
} from '../../openapi-registry';
import { fetchProjectBundle, mapProjectMember, parseUserId, requireProjectIdParam } from './project_helpers';
import { requireAssignableUsers, requireOpenProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import {
  addProjectMember,
  callerOf,
  removeProjectMember,
  updateProjectMemberRole,
  type Caller,
} from '../../services/projectData';

// Members of a project and their role in it (MAIR-1088), written by its managers. A `manager` member manages the
// project. Project API refuses to change the role of the owner or to remove them (409) and answers 404 for a user who
// is not a member. `PATCH /projects/{projectId}` with `assigneeIds` still rewrites the members as a whole.

const router = Router();

const ERROR_STATUSES = [400, 401, 403, 404, 409, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

const membersResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ProjectMembers } },
});

/** Every member of the project, re-read after the write, with their role and load. */
async function answerMembers(caller: Caller, projectId: number, res: Response, status: number): Promise<void> {
  const bundle = await fetchProjectBundle(caller, projectId);
  res.status(status).json({ members: bundle.users.map((user) => mapProjectMember(user, bundle.tasks)) });
}

/** The `user-<id>` of a path, already shaped by the params schema. */
function memberIdOf(value: string): number {
  return parseUserId(value) as number;
}

registry.registerPath({
  method: 'post',
  path: '/projects/{projectId}/members',
  tags: ['Members'],
  summary: 'Adds a member to a project',
  description: 'Reserved to the project managers (a `manager` member included). The agent must be one the caller may assign (403 otherwise). `role` defaults to `contributor`; `409` when Project API refuses the member (already one).',
  request: {
    params: ProjectIdParams,
    body: { required: true, content: { 'application/json': { schema: AddProjectMemberBody } } },
  },
  responses: { ...apiErrorResponses(...ERROR_STATUSES), 201: membersResponse('Members of the project, the new one included') },
});

router.post('/:projectId/members', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const body = parseRequest(AddProjectMemberBody, req.body, 'body');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);

  const { user } = await requireOpenProjectManagement(caller, getProjectUserContext(res), projectId);
  await requireAssignableUsers(caller, user, [body.userId]);
  await addProjectMember(caller, projectId, memberIdOf(body.userId), body.role);
  await answerMembers(caller, projectId, res, 201);
});

registry.registerPath({
  method: 'patch',
  path: '/projects/{projectId}/members/{userId}',
  tags: ['Members'],
  summary: 'Changes the role of a member',
  description: 'Reserved to the project managers. `404` for a user who is not a member, `409` for the owner of the project (always `manager`).',
  request: {
    params: ProjectMemberParams,
    body: { required: true, content: { 'application/json': { schema: UpdateProjectMemberBody } } },
  },
  responses: { ...apiErrorResponses(...ERROR_STATUSES), 200: membersResponse('Members of the project, as re-read') },
});

router.patch('/:projectId/members/:userId', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectMemberParams, req.params, 'params');
  const body = parseRequest(UpdateProjectMemberBody, req.body, 'body');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);

  await requireOpenProjectManagement(caller, getProjectUserContext(res), projectId);
  await updateProjectMemberRole(caller, projectId, memberIdOf(params.userId), body.role);
  await answerMembers(caller, projectId, res, 200);
});

registry.registerPath({
  method: 'delete',
  path: '/projects/{projectId}/members/{userId}',
  tags: ['Members'],
  summary: 'Removes a member from a project',
  description: 'Reserved to the project managers. Their tasks of the project are unassigned by Project API. `409` for the owner of the project.',
  request: { params: DeletedProjectMemberParams },
  responses: { ...apiErrorResponses(...ERROR_STATUSES), 204: { description: 'Member removed' } },
});

router.delete('/:projectId/members/:userId', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectMemberParams, req.params, 'params');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);

  await requireOpenProjectManagement(caller, getProjectUserContext(res), projectId);
  await removeProjectMember(caller, projectId, memberIdOf(params.userId));
  res.status(204).end();
});

export default router;
