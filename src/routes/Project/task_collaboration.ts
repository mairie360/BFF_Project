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
import { addTaskComment, getTaskCollaboration } from '../../services/projectData';
import { handleUnknownError, parseProjectId, parseTaskId, sendValidationError } from './project_helpers';
import { requireTaskComment, requireTaskView } from './project_access';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
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

function parseTaskParams(req: Request, res: Response): { projectId: number; taskId: number } | null {
  const paramsResult = ProjectTaskParams.safeParse(req.params);
  if (!paramsResult.success) {
    sendValidationError(res, 'params', paramsResult.error.issues);
    return null;
  }
  const projectId = parseProjectId(paramsResult.data.projectId);
  const taskId = parseTaskId(paramsResult.data.taskId);
  if (projectId === null || taskId === null) {
    sendValidationError(res, 'params', [{ message: 'projectId and taskId must be project-<id> and task-<id> identifiers' }]);
    return null;
  }
  return { projectId, taskId };
}

router.get('/:projectId/tasks/:taskId/collaboration', async (req: Request, res: Response) => {
  const params = parseTaskParams(req, res);
  if (!params) return;
  try {
    if (!await requireTaskView(res, params.projectId, params.taskId)) return;
    return res.status(200).json(await getTaskCollaboration(params.projectId, params.taskId));
  } catch (error) {
    return handleUnknownError(res, error, COLLABORATION_ERROR_STATUSES);
  }
});

router.post('/:projectId/tasks/:taskId/comments', async (req: Request, res: Response) => {
  const params = parseTaskParams(req, res);
  if (!params) return;
  const bodyResult = TaskCommentBody.safeParse(req.body);
  if (!bodyResult.success) return sendValidationError(res, 'body', bodyResult.error.issues);

  try {
    const access = await requireTaskComment(res, params.projectId, params.taskId);
    if (!access) return;
    const { user } = access;
    return res.status(201).json(await addTaskComment(params.projectId, params.taskId, user, bodyResult.data.message));
  } catch (error) {
    return handleUnknownError(res, error, COMMENT_ERROR_STATUSES);
  }
});

export default router;
