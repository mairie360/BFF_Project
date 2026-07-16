import { Router, Request, Response } from 'express';
import { registry, ProjectTaskParams, UpdateTaskBody, ProjectTask, ApiError } from '../../openapi-registry';
import {
    fetchProjectBundle,
    handleUnknownError,
    mapTaskUpdateBodyToBackend,
    buildTaskDtoForUser,
    patchTaskOnApi,
    parsePublicId,
    sendValidationError,
} from './project_helpers';
import { requireAssignableUsers, requireTaskManagement } from './project_access';
import { appendTaskHistory } from '../../repositories/projectRepository';

const router = Router();

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}/tasks/{taskId}',
    tags: ['Projects'],
    summary: 'Met à jour une tâche existante pour un projet',

    request: {
        params: ProjectTaskParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateTaskBody,
                },
            },
        },
    },

    responses: {
        200: {
            description: 'Tâche mise à jour avec succès',
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
            description: 'Projet ou tâche introuvable',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },
    },
});

router.patch('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const paramsResult = ProjectTaskParams.safeParse(req.params);
    const bodyResult = UpdateTaskBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, bodyResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);
    const taskId = parsePublicId(paramsResult.data.taskId);

    if (projectId === null || taskId === null) {
        return sendValidationError(res, [
            {
                code: 'invalid_format',
                path: ['projectId', 'taskId'],
                message: 'projectId and taskId must end with numeric identifiers',
            },
        ]);
    }

    try {
        const user = await requireTaskManagement(res, projectId, taskId);
        if (!user) return;
        const requestedUserIds = [
            ...(bodyResult.data.responsibleId ? [bodyResult.data.responsibleId] : []),
            ...(bodyResult.data.assigneeIds ?? []),
        ];
        if (!await requireAssignableUsers(res, user, requestedUserIds)) return;
        const initialBundle = await fetchProjectBundle(projectId);
        const task = initialBundle.tasks.find((entry) => entry.id === taskId);

        if (!task) {
            return res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: 'Task not found',
                    details: [],
                },
            });
        }

        const backendPayload = mapTaskUpdateBodyToBackend(bodyResult.data);
        if (Object.keys(backendPayload).length > 0) {
            await patchTaskOnApi(projectId, taskId, backendPayload);
        }
        await appendTaskHistory(
            projectId,
            taskId,
            user,
            'task_updated',
            `Tâche « ${bodyResult.data.title ?? task.title} » modifiée.`,
            bodyResult.data,
        );

        const updatedBundle = await fetchProjectBundle(projectId);
        const updatedTask = updatedBundle.tasks.find((entry) => entry.id === taskId);

        if (!updatedTask) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Task not found after update', details: [] },
            });
        }

        return res.status(200).json(
            await buildTaskDtoForUser(user, projectId, updatedTask, updatedBundle.users),
        );
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;
