import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, CreateTaskBody, ProjectTask, ApiError } from '../../openapi-registry';
import {
    createTaskOnApi,
    buildTaskDtoForUser,
    fetchProjectBundle,
    handleUnknownError,
    mapTaskInputToBackend,
    parsePublicId,
    sendValidationError,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { appendTaskHistory } from '../../repositories/projectRepository';

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
        const user = await requireProjectManagement(res, projectId);
        if (!user) return;
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
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found after creation', details: [] } });
        }

        return res.status(201).json(await buildTaskDtoForUser(user, projectId, task, bundle.users));
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;
