import { AsyncLocalStorage } from 'node:async_hooks';
import { authorization } from '@mairie360/bffs-lib';
import type { NextFunction, Request, Response } from 'express';

interface TokenContext {
  authorization: string;
}

const tokenStorage = new AsyncLocalStorage<TokenContext>();

/** The caller's `Authorization: Bearer <token>` header, as normalised by the lib, for the current session-bound request. */
export function getAuthorizationHeader(): string | undefined {
  return tokenStorage.getStore()?.authorization;
}

/**
 * Stores the caller's normalised `Authorization` header for the upstream clients of the current request.
 * Mounted after `requireBearer` on the session-bound routers only, so public routes (`/health`,
 * `/check_apis`) never forward anything upstream; a request without a Bearer token gets a 401 here too.
 */
export function tokenContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  let header: string;
  try {
    header = authorization(req);
  } catch (error) {
    next(error);
    return;
  }
  tokenStorage.run({ authorization: header }, next);
}
