import { Router, type Request, type Response } from 'express';
import { parseRequest, validationError } from '@mairie360/bffs-lib';
import {
  apiErrorResponses,
  type ApiErrorStatus,
  CreateMilestoneBody,
  DeletedProjectMilestoneParams,
  Milestone,
  MilestonesQuery,
  ProjectIdParams,
  ProjectMilestoneParams,
  ProjectMilestones,
  registry,
  UpdateMilestoneBody,
} from '../../openapi-registry';
import { buildPagination, mapMilestone, parseMilestoneId, requireProjectIdParam } from './project_helpers';
import { requireOpenProjectManagement, requireProjectView } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import {
  callerOf,
  createProjectMilestone,
  deleteProjectMilestone,
  listProjectMilestones,
  updateProjectMilestone,
} from '../../services/projectData';

// Milestones of a project (MAIR-1086): read by whoever sees the project, written by its managers. Project API stores
// them (soft delete) and answers 404 for a milestone of another project or a deleted one.

const router = Router();

const READ_STATUSES = [400, 401, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];
const WRITE_STATUSES = [400, 401, 403, 404, 409, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

const milestoneResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: Milestone } },
});

/** `project-<id>` and `milestone-<id>` path parameters → ids, or the 400 of a validation failure on `params`. */
function requireMilestoneParams(params: { projectId: string; milestoneId: string }): { projectId: number; milestoneId: number } {
  const projectId = requireProjectIdParam(params.projectId);
  const milestoneId = parseMilestoneId(params.milestoneId);
  if (milestoneId === null) {
    throw validationError('params', [{ path: ['milestoneId'], message: 'milestoneId must be a milestone-<id> identifier' }]);
  }
  return { projectId, milestoneId };
}

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}/milestones',
  tags: ['Milestones'],
  summary: 'Lists the milestones of a project',
  description: 'One page of the milestones of the project (MAIR-1086), by due date then id; deleted ones are left out. Open to whoever sees the project (`404` otherwise).',
  request: { params: ProjectIdParams, query: MilestonesQuery },
  responses: {
    ...apiErrorResponses(...READ_STATUSES),
    200: { description: 'Milestones of the page', content: { 'application/json': { schema: ProjectMilestones } } },
  },
});

router.get('/:projectId/milestones', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const query = parseRequest(MilestonesQuery, req.query, 'query');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, READ_STATUSES);
  const page = query.page ?? 1;
  const limit = query.limit ?? 100;

  await requireProjectView(caller, getProjectUserContext(res), projectId);
  const result = await listProjectMilestones(caller, projectId, { limit, offset: (page - 1) * limit });
  res.status(200).json({
    milestones: result.milestones.map(mapMilestone),
    pagination: buildPagination(result.total, page, limit),
  });
});

registry.registerPath({
  method: 'post',
  path: '/projects/{projectId}/milestones',
  tags: ['Milestones'],
  summary: 'Adds a milestone to a project',
  description: 'Reserved to the project managers. `reached` defaults to `false`.',
  request: {
    params: ProjectIdParams,
    body: { required: true, content: { 'application/json': { schema: CreateMilestoneBody } } },
  },
  responses: { ...apiErrorResponses(...WRITE_STATUSES), 201: milestoneResponse('The created milestone') },
});

router.post('/:projectId/milestones', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const body = parseRequest(CreateMilestoneBody, req.body, 'body');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, WRITE_STATUSES);

  await requireOpenProjectManagement(caller, getProjectUserContext(res), projectId);
  const created = await createProjectMilestone(caller, projectId, {
    title: body.title,
    due_date: body.dueDate,
    ...(body.reached !== undefined ? { reached: body.reached } : {}),
  });
  res.status(201).json(mapMilestone(created));
});

registry.registerPath({
  method: 'patch',
  path: '/projects/{projectId}/milestones/{milestoneId}',
  tags: ['Milestones'],
  summary: 'Updates a milestone',
  description: 'Reserved to the project managers; an absent field is left unchanged (`reached: false` reopens it). `404` for a milestone of another project or a deleted one.',
  request: {
    params: ProjectMilestoneParams,
    body: { required: true, content: { 'application/json': { schema: UpdateMilestoneBody } } },
  },
  responses: { ...apiErrorResponses(...WRITE_STATUSES), 200: milestoneResponse('The updated milestone') },
});

router.patch('/:projectId/milestones/:milestoneId', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectMilestoneParams, req.params, 'params');
  const body = parseRequest(UpdateMilestoneBody, req.body, 'body');
  const { projectId, milestoneId } = requireMilestoneParams(params);
  const caller = callerOf(req, WRITE_STATUSES);

  await requireOpenProjectManagement(caller, getProjectUserContext(res), projectId);
  const updated = await updateProjectMilestone(caller, projectId, milestoneId, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.dueDate !== undefined ? { due_date: body.dueDate } : {}),
    ...(body.reached !== undefined ? { reached: body.reached } : {}),
  });
  res.status(200).json(mapMilestone(updated));
});

registry.registerPath({
  method: 'delete',
  path: '/projects/{projectId}/milestones/{milestoneId}',
  tags: ['Milestones'],
  summary: 'Deletes a milestone',
  description: 'Reserved to the project managers. `404` for an unknown or already deleted milestone.',
  request: { params: DeletedProjectMilestoneParams },
  responses: { ...apiErrorResponses(...WRITE_STATUSES), 204: { description: 'Milestone deleted' } },
});

router.delete('/:projectId/milestones/:milestoneId', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectMilestoneParams, req.params, 'params');
  const { projectId, milestoneId } = requireMilestoneParams(params);
  const caller = callerOf(req, WRITE_STATUSES);

  await requireOpenProjectManagement(caller, getProjectUserContext(res), projectId);
  await deleteProjectMilestone(caller, projectId, milestoneId);
  res.status(204).end();
});

export default router;
