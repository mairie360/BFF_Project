// src/config/token.ts

/**
 * Token JWT de secours (Fallback) utilisé en développement.
 * Laisse une chaîne vide par défaut.
 */
export const DEFAULT_JWT_TOKEN = process.env.PROJECT_API_TOKEN?.trim() ?? '';
