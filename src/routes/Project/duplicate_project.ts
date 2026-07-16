import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
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
import { createProjectRecord, isProjectDatabaseAccessEnabled } from '../../repositories/projectRepository';

const router = Router();

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/duplicate',
    tags: ['Projects'],
    summary: 'Duplique un projet existant',

    request: {
        params: ProjectIdParams,
    },

    responses: {
        201: {
            description: 'Projet dupliqué avec succès',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
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

router.post('/:projectId/duplicate', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, paramsResult.error.issues);
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
        const createdProject = isProjectDatabaseAccessEnabled()
            ? {
                project_id: await createProjectRecord(user.id, {
                    title: duplicateBody.title,
                    description: duplicateBody.description,
                }),
            }
            : await createProjectOnApi(mapProjectCreateBodyToBackend(duplicateBody));
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
                    dueDate: task.due_date,
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
                        dueDate: task.due_date,
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
        return handleUnknownError(res, error);
    }
});

export default router;
