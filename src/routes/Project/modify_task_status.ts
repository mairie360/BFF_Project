import { Router, Request, Response } from 'express';
import { registry, ProjectTaskParams, UpdateTaskStatusBody, ProjectTask, ApiError } from '../../openapi-registry';
import {
    fetchProjectBundle,
    handleUnknownError,
    buildTaskDtoForUser,
    mapTaskStatusToBackend,
    patchTaskOnApi,
    parsePublicId,
    sendValidationError,
} from './project_helpers';
import { requireTaskStatusUpdate } from './project_access';
import { appendTaskHistory } from '../../repositories/projectRepository';

const router = Router();

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}/tasks/{taskId}/status',
    tags: ['Projects'],
    summary: 'Met à jour le statut d’une tâche existante pour un projet',

    request: {
        params: ProjectTaskParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateTaskStatusBody,
                },
            },
        },
    },

    responses: {
        200: {
            description: 'Statut de la tâche mis à jour avec succès',
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

router.patch('/:projectId/tasks/:taskId/status', async (req: Request, res: Response) => {
    const paramsResult = ProjectTaskParams.safeParse(req.params);
    const bodyResult = UpdateTaskStatusBody.safeParse(req.body);

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
        const bundle = await fetchProjectBundle(projectId);
        const task = bundle.tasks.find((entry) => entry.id === taskId);

        if (!task) {
            return res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: 'Task not found',
                    details: [],
                },
            });
        }
        const user = await requireTaskStatusUpdate(
            res,
            projectId,
            taskId,
            task.assigned_to,
        );
        if (!user) return;

        await patchTaskOnApi(projectId, taskId, {
            status: mapTaskStatusToBackend(bodyResult.data.status),
        });
        await appendTaskHistory(
            projectId,
            taskId,
            user,
            'status_changed',
            `Statut de « ${task.title} » modifié en ${bodyResult.data.status}.`,
            { status: { from: task.status, to: bodyResult.data.status } },
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
