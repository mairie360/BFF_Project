import { z } from 'zod';
import { registry } from '../openapi-registry';

// 1. Définition du schéma (qui générera le Swagger ET validera tes données si besoin)
export const CheckApiResponseSchema = registry.register('CheckApiResponse', z.object({
  status: z.string().openapi({ example: 'OK' }),
  core_api: z.string().openapi({ example: 'Connected' }),
  project_api: z.string().openapi({ example: 'Connected' }),
}));

// 2. Génération automatique de l'interface TypeScript (plus besoin de l'écrire à la main !)
export type CheckApiResponse = z.infer<typeof CheckApiResponseSchema>;