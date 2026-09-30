import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
    buildProjectResponseFromState,
    buildProjectResponseOverridesFromCreateBody,
    buildTaskResponseFromState,
    createProjectOnApi,
    createTaskOnApi,
    fetchProjectBundle,
    handleUnknownError,
    mapProjectCreateBodyToBackend,
    mapTaskInputToBackend,
    mapTaskPriority,
    mapTaskStatus,
    parsePublicId,
    sendValidationError,
    syncProjectUsersOnApi,
} from './project_helpers';
import { requireProjectManagement } from './project_access';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/duplicate',
    tags: ['Projects'],
    summary: 'Duplique un projet existant',

    request: {
        params: ProjectIdParams,
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        201: {
            description: 'Projet dupliqué avec succès',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
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

router.post('/:projectId/duplicate', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, 'params', [
            {
                path: ['projectId'],
                message: 'projectId must end with a numeric identifier',
            },
        ]);
    }

    try {
        const user = await requireProjectManagement(res, projectId);
        if (!user) return;
        const sourceBundle = await fetchProjectBundle(projectId);
        const duplicateBody = {
                title: sourceBundle.project.name,
                description: sourceBundle.project.description,
                status: 'todo' as const,
                priority: 'medium' as const,
                responsibleId: sourceBundle.users[0] ? `user-${sourceBundle.users[0].id}` : `project-${projectId}`,
                assigneeIds: sourceBundle.users.map((user) => `user-${user.id}`),
                labels: [],
                dueDate: new Date().toISOString(),
            };
        const createdProject = await createProjectOnApi(mapProjectCreateBodyToBackend(duplicateBody));
        await syncProjectUsersOnApi(
            createdProject.project_id,
            sourceBundle.users.map((member) => `user-${member.id}`),
        );

        for (const task of sourceBundle.tasks) {
            await createTaskOnApi(
                createdProject.project_id,
                mapTaskInputToBackend({
                    title: task.title,
                    status: mapTaskStatus(task.status),
                    priority: mapTaskPriority(task.priority),
                    assigneeIds: [],
                    labels: [],
                    dueDate: task.due_date ?? new Date().toISOString(),
                }),
            );
        }

        const duplicatedBundle = await fetchProjectBundle(createdProject.project_id);

        return res.status(201).json({
            project: buildProjectResponseFromState({
                project: duplicatedBundle.project,
                tasks: duplicatedBundle.tasks,
                users: duplicatedBundle.users,
                override: buildProjectResponseOverridesFromCreateBody({
                    title: sourceBundle.project.name,
                    description: sourceBundle.project.description,
                    status: 'todo',
                    priority: 'medium',
                    responsibleId: sourceBundle.users[0] ? `user-${sourceBundle.users[0].id}` : `project-${createdProject.project_id}`,
                    assigneeIds: sourceBundle.users.map((user) => `user-${user.id}`),
                    labels: [],
                    dueDate: new Date().toISOString(),
                    taskItems: sourceBundle.tasks.map((task) => ({
                        title: task.title,
                        status: 'todo',
                        priority: 'medium',
                        assigneeIds: [],
                        labels: [],
                        dueDate: task.due_date ?? new Date().toISOString(),
                    })),
                }),
            }),
            taskItems: duplicatedBundle.tasks.map((task) =>
                buildTaskResponseFromState({
                    task,
                    users: duplicatedBundle.users,
                }),
            ),
        });
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
