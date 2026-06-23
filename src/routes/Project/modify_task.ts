import {Router, Request, Response} from 'express';
import {
    registry,
    ProjectTaskParams,
    UpdateTaskBody,
    ProjectTask,
    ApiError,
} from '../../openapi-registry';

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

router.patch('/:projectId/tasks/:taskId', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;