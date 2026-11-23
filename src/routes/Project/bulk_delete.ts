import { Router, type Request, type Response } from 'express';
import { parseRequest } from '@mairie360/bffs-lib';
import {
  apiErrorResponses,
  type ApiErrorStatus,
  BulkDeleteProjectsBody,
  BulkDeleteProjectsResult,
  registry,
} from '../../openapi-registry';
import { parseProjectId, projectPublicId } from './project_helpers';
import { bulkDeleteProjects, callerOf } from '../../services/projectData';

// Deletion of several projects (MAIR-1089). Project API deletes each one with the rule of a single deletion (the
// caller manages it: Admin, Maire, a Responsable who sees it, its owner or a `manager` member) and tells, per project,
// whether it was deleted, unknown or not visible (`not_found`) or refused (`forbidden`): no project is refused as a
// whole, so the BFF does not check the role first.

const router = Router();

const ERROR_STATUSES = [400, 401, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'post',
  path: '/projects/bulk-delete',
  tags: ['Projects'],
  summary: 'Deletes several projects',
  description: 'Deletes each project the caller may delete, one by one (MAIR-1089), and answers one result per project: `deleted`, `not_found` (unknown or not visible) or `forbidden` (visible but not managed by the caller).',
  request: { body: { required: true, content: { 'application/json': { schema: BulkDeleteProjectsBody } } } },
  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: { description: 'One result per project', content: { 'application/json': { schema: BulkDeleteProjectsResult } } },
  },
});

router.post('/bulk-delete', async (req: Request, res: Response) => {
  const body = parseRequest(BulkDeleteProjectsBody, req.body, 'body');
  const caller = callerOf(req, ERROR_STATUSES);
  // Shaped by the body schema; a repeated id is sent once.
  const ids = Array.from(new Set(body.projectIds.map((projectId) => parseProjectId(projectId) as number)));

  const results = await bulkDeleteProjects(caller, ids);
  res.status(200).json({ results: results.map(({ id, status }) => ({ projectId: projectPublicId(id), status })) });
});

export default router;
