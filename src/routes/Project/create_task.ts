import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, CreateTaskBody, ProjectTask, ErrorResponse } from '../../openapi-registry';
import {
    createTaskOnApi,
    buildTaskDtoForUser,
    fetchProjectBundle,
    handleUnknownError,
    sendError,
    mapTaskInputToBackend,
    parseProjectId,
    sendValidationError,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { appendTaskHistory } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/tasks',
    tags: ['Projects'],
    summary: 'Crée une nouvelle tâche pour un projet existant',

    request: {
        params: ProjectIdParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: CreateTaskBody,
                },
            },
        },
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        201: {
            description: 'Tâche créée avec succès',
            content: {
                'application/json': {
                    schema: ProjectTask,
                },
            },
        },

        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },

        404: {
            description: 'Project not found',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },
    },
});

router.post('/:projectId/tasks', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);
    const bodyResult = CreateTaskBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, 'body', bodyResult.error.issues);
    }

    const projectId = parseProjectId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, 'params', [
            {
                path: ['projectId'],
                message: 'projectId must be a project-<id> identifier',
            },
        ]);
    }

    try {
        const access = await requireProjectManagement(res, projectId);
        if (!access) return;
        const { user } = access;
        if (!await requireAssignableUsers(res, user, [bodyResult.data.responsibleId, ...bodyResult.data.assigneeIds])) return;
        const createdTask = await createTaskOnApi(
            projectId,
            mapTaskInputToBackend({
                title: bodyResult.data.title,
                status: bodyResult.data.status,
                priority: bodyResult.data.priority,
                responsibleId: bodyResult.data.responsibleId,
                assigneeIds: bodyResult.data.assigneeIds,
                labels: bodyResult.data.labels,
                dueDate: bodyResult.data.dueDate,
            }),
        );

        await appendTaskHistory(projectId, createdTask.task_id, user, 'task_created', `Tâche « ${bodyResult.data.title} » créée.`);
        const bundle = await fetchProjectBundle(projectId);
        const task = bundle.tasks.find((entry) => entry.id === createdTask.task_id);
        if (!task) {
            return sendError(res, 404, 'Task not found after creation');
        }

        return res.status(201).json(await buildTaskDtoForUser(user, projectId, task, bundle.users));
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
