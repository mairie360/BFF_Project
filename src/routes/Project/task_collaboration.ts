import { Router, type Request, type Response } from 'express';
import {
  apiErrorResponses,
  type ApiErrorStatus,
  ProjectTaskParams,
  TaskCollaborationResponse,
  TaskComment,
  TaskCommentBody,
  registry,
} from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import { addTaskComment, callerOf, getTaskCollaboration } from '../../services/projectData';
import { getProjectUserContext } from '../../auth/project-user';
import { requireTaskParams } from './project_helpers';
import { requireTaskComment, requireTaskView } from './project_access';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const COLLABORATION_ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];
// 404: Project API answers it when the task disappears between the rights check and the comment.
const COMMENT_ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}/tasks/{taskId}/collaboration',
  tags: ['Projects'],
  summary: 'Consulte les commentaires et l’historique d’une tâche',
  request: { params: ProjectTaskParams },
  responses: {
    ...apiErrorResponses(...COLLABORATION_ERROR_STATUSES),
    200: { description: 'Suivi collaboratif', content: { 'application/json': { schema: TaskCollaborationResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects/{projectId}/tasks/{taskId}/comments',
  tags: ['Projects'],
  summary: 'Ajoute un commentaire à une tâche',
  request: {
    params: ProjectTaskParams,
    body: { required: true, content: { 'application/json': { schema: TaskCommentBody } } },
  },
  responses: {
    ...apiErrorResponses(...COMMENT_ERROR_STATUSES),
    201: { description: 'Commentaire ajouté', content: { 'application/json': { schema: TaskComment } } },
  },
});

router.get('/:projectId/tasks/:taskId/collaboration', async (req: Request, res: Response) => {
  const { projectId, taskId } = requireTaskParams(parseRequest(ProjectTaskParams, req.params, 'params'));
  const caller = callerOf(req, COLLABORATION_ERROR_STATUSES);

  await requireTaskView(caller, getProjectUserContext(res), projectId, taskId);
  res.status(200).json(await getTaskCollaboration(caller, projectId, taskId));
});

router.post('/:projectId/tasks/:taskId/comments', async (req: Request, res: Response) => {
  const { projectId, taskId } = requireTaskParams(parseRequest(ProjectTaskParams, req.params, 'params'));
  const body = parseRequest(TaskCommentBody, req.body, 'body');
  const caller = callerOf(req, COMMENT_ERROR_STATUSES);

  await requireTaskComment(caller, getProjectUserContext(res), projectId, taskId);
  res.status(201).json(await addTaskComment(caller, projectId, taskId, body.message));
});

export default router;
