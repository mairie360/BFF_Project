import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, CreateTaskBody, ProjectTask, ApiError } from '../../openapi-registry';
import {
    createTaskOnApi,
    handleUnknownError,
    mapTaskInputToBackend,
    mapTaskPriorityLabel,
    mapTaskStatusLabel,
    parsePublicId,
    sendValidationError,
    taskPublicId,
} from './project_helpers';

const router = Router();

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
        201: {
            description: 'Tâche créée avec succès',
            content: {
                'application/json': {
                    schema: ProjectTask,
                },
            },
        },

        400: {
            description: 'Erreur de validation',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },

        404: {
            description: 'Projet introuvable',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },
    },
});

router.post('/:projectId/tasks', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);
    const bodyResult = CreateTaskBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, bodyResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, [
            {
                code: 'invalid_format',
                path: ['projectId'],
                message: 'projectId must end with a numeric identifier',
            },
        ]);
    }

    try {
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

        const now = new Date().toISOString();

        return res.status(201).json({
            id: taskPublicId(createdTask.task_id),
            title: bodyResult.data.title,
            status: bodyResult.data.status,
            statusLabel: mapTaskStatusLabel(bodyResult.data.status),
            responsible: {
                id: bodyResult.data.responsibleId,
                name: bodyResult.data.responsibleId,
                avatarUrl: null,
            },
            assignees: bodyResult.data.assigneeIds.map((assigneeId) => ({
                id: assigneeId,
                name: assigneeId,
                avatarUrl: null,
            })),
            priority: bodyResult.data.priority,
            priorityLabel: mapTaskPriorityLabel(bodyResult.data.priority),
            labels: bodyResult.data.labels,
            dueDate: bodyResult.data.dueDate,
            completed: bodyResult.data.status === 'done',
            createdAt: now,
            updatedAt: now,
        });
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;