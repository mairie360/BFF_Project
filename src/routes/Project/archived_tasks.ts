import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { HttpError, parseRequest } from '@mairie360/bffs-lib';
import {
  apiErrorResponses,
  type ApiErrorStatus,
  ProjectIdParams,
  ProjectTask,
  registry,
} from '../../openapi-registry';
import { callerOf, listArchivedTasks, listProjectUsers } from '../../services/projectData';
import { getProjectUserContext } from '../../auth/project-user';
import { buildPagination, buildTaskDtoForUser, requireProjectIdParam } from './project_helpers';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

/** Page of the archived tasks: `page` from 1, `limit` from 1 to 100 (20 by default). */
export const ArchivedTasksQuery = registry.register('ArchivedTasksQuery', z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional().openapi({ example: 1 }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ example: 20 }),
}));

export const ArchivedTasksResponse = registry.register('ArchivedTasksResponse', z.object({
  tasks: z.array(ProjectTask).openapi({
    description: 'Archived tasks of the page the caller may see, the most recently archived first',
  }),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number().openapi({ description: 'Number of archived tasks of the project' }),
    hasNextPage: z.boolean(),
  }),
}));

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}/archived-tasks',
  tags: ['Projects'],
  summary: 'Lists the archived tasks of a project',
  description: 'A task is archived as soon as it is done (MAIR-502): `GET /projects/{projectId}` only returns the '
    + 'active tasks and counts the archived ones in its progress; this route pages the archived ones, the most '
    + 'recently archived first. Like the project detail, a member without manager role only sees the tasks '
    + 'assigned to them.',
  request: { params: ProjectIdParams, query: ArchivedTasksQuery },
  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: { description: 'One page of the archived tasks', content: { 'application/json': { schema: ArchivedTasksResponse } } },
  },
});

router.get('/:projectId/archived-tasks', async (req: Request, res: Response) => {
  const projectId = requireProjectIdParam(parseRequest(ProjectIdParams, req.params, 'params').projectId);
  const query = parseRequest(ArchivedTasksQuery, req.query, 'query');
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const caller = callerOf(req, ERROR_STATUSES);
  const user = getProjectUserContext(res);

  // Project API answers 404 for a project the caller cannot see; the members name the assignees.
  const [archived, users] = await Promise.all([
    listArchivedTasks(caller, projectId, { limit, offset: (page - 1) * limit }),
    listProjectUsers(caller, projectId).catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 404) return [];
      throw error;
    }),
  ]);
  if (!archived) throw new HttpError(404, 'Project not found or not visible.');

  res.status(200).json({
    tasks: archived.tasks
      .map((task) => buildTaskDtoForUser(user, task, users))
      .filter((task) => task.permissions.canView),
    pagination: buildPagination(archived.total, page, limit),
  });
});

export default router;
