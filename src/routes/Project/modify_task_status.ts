import {Router, Request, Response} from 'express';
import {
    registry,
    ProjectTaskParams,
    UpdateTaskStatusBody,
    ProjectStatus,
    ApiError,
} from '../../openapi-registry';

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
                    schema: ProjectStatus,
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

router.patch('/:projectId/tasks/:taskId/status', (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
    });
});

export default router;