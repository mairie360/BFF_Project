import { Router, type Request, type Response } from 'express';
import { parseRequest } from '@mairie360/bffs-lib';
import type { ActivityItemView } from '@mairie360/project-api-openapi/model';
import type { z } from 'zod';
import {
  ActivityItem,
  ActivityQuery,
  apiErrorResponses,
  type ApiErrorStatus,
  ProjectActivity,
  ProjectCommentBody,
  ProjectIdParams,
  registry,
} from '../../openapi-registry';
import { buildPagination, requireProjectIdParam, taskPublicId, userPublicId } from './project_helpers';
import { addProjectComment, callerOf, listProjectActivity } from '../../services/projectData';

// Activity of a project (MAIR-1089): its comments and the history of its tasks (archived ones included), newest first,
// and the comments any viewer adds. Project API checks the project is visible to the caller (404 otherwise) and signs
// the comment with the forwarded session.

const router = Router();

// No 403: every viewer reads the activity and comments the project.
const ERROR_STATUSES = [400, 401, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];
// A comment on a closed project is refused by Project API (409), relayed as is.
const COMMENT_ERROR_STATUSES = [...ERROR_STATUSES, 409] as const satisfies readonly ApiErrorStatus[];

type BffActivityItem = z.infer<typeof ActivityItem>;

/** An activity entry of Project API with the BFF's public ids. */
export function mapActivityItem(item: ActivityItemView): BffActivityItem {
  return {
    kind: item.kind,
    id: `${item.kind === 'comment' ? 'comment' : 'history'}-${item.id}`,
    taskId: item.task_id == null ? null : taskPublicId(item.task_id),
    taskTitle: item.task_title ?? null,
    author: item.author_id == null ? null : { id: userPublicId(item.author_id), name: item.author_name ?? 'Inconnu' },
    message: item.message ?? null,
    changes: item.changes ?? null,
    label: item.label,
    createdAt: item.created_at,
  };
}

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}/activity',
  tags: ['Activity'],
  summary: 'Lists the activity of a project',
  description: 'One page of the comments of the project and of the history of all its tasks (archived ones included), newest first (MAIR-1089). Open to whoever sees the project (`404` otherwise).',
  request: { params: ProjectIdParams, query: ActivityQuery },
  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: { description: 'Entries of the page', content: { 'application/json': { schema: ProjectActivity } } },
  },
});

router.get('/:projectId/activity', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const query = parseRequest(ActivityQuery, req.query, 'query');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, ERROR_STATUSES);
  const page = query.page ?? 1;
  const limit = query.limit ?? 50;

  const result = await listProjectActivity(caller, projectId, { limit, offset: (page - 1) * limit });
  res.status(200).json({ items: result.items.map(mapActivityItem), pagination: buildPagination(result.total, page, limit) });
});

registry.registerPath({
  method: 'post',
  path: '/projects/{projectId}/comments',
  tags: ['Activity'],
  summary: 'Comments a project',
  description: 'Open to whoever sees the project (`404` otherwise), signed by the caller (MAIR-1089). Answers the new activity entry. A closed project is read-only: `409`.',
  request: {
    params: ProjectIdParams,
    body: { required: true, content: { 'application/json': { schema: ProjectCommentBody } } },
  },
  responses: {
    ...apiErrorResponses(...COMMENT_ERROR_STATUSES),
    201: { description: 'The comment, as an activity entry', content: { 'application/json': { schema: ActivityItem } } },
  },
});

router.post('/:projectId/comments', async (req: Request, res: Response) => {
  const params = parseRequest(ProjectIdParams, req.params, 'params');
  const body = parseRequest(ProjectCommentBody, req.body, 'body');
  const projectId = requireProjectIdParam(params.projectId);
  const caller = callerOf(req, COMMENT_ERROR_STATUSES);

  const created = await addProjectComment(caller, projectId, body.message);
  res.status(201).json(mapActivityItem(created));
});

export default router;
