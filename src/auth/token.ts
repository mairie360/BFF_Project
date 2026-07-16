import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

interface TokenContext {
  authorization?: string;
}

const tokenStorage = new AsyncLocalStorage<TokenContext>();

export function readBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  return token || undefined;
}

export function getBearerToken(): string | undefined {
  const authorization = tokenStorage.getStore()?.authorization;
  return authorization ? readBearerToken(authorization) : undefined;
}

export function getAuthorizationHeader(): string | undefined {
  return tokenStorage.getStore()?.authorization;
}

export function buildAuthorizationHeaders(): Record<string, string> {
  const authorization = getAuthorizationHeader();
  return authorization ? { Authorization: authorization } : {};
}

export function tokenContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearerToken(req.header('authorization'));
  tokenStorage.run({ authorization: token ? `Bearer ${token}` : undefined }, next);
}

export function requireBearerToken(req: Request, res: Response, next: NextFunction): Response | void {
  if (!req.header('authorization')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token',
        details: [],
      },
    });
  }

  if (!readBearerToken(req.header('authorization'))) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid authorization header. Expected: Bearer <token>',
        details: [],
      },
    });
  }

  return next();
}
