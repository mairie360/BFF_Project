import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * Session keys of the tests (MAIR-680): the tests play Core, the only signer, with an Ed25519 key pair generated
 * when the test file loads (no private key is committed), and the BFF gets its public key in `JWT_PUBLIC_KEY`,
 * without `JWT_SECRET`, like a deployment once the transition is over.
 */

/** Claims Core signs into every EdDSA session token (`mairie360_api_lib`, `SESSION_JWT_ISSUER` / `_AUDIENCE`). */
export const SESSION_ISSUER = 'mairie360-core';
export const SESSION_AUDIENCE = 'mairie360';

/** RFC 7638 thumbprint of an Ed25519 public key: the `kid` Core puts in the header of the tokens it signs. */
export function keyId(publicKey: KeyObject): string {
  const { x } = publicKey.export({ format: 'jwk' });
  return createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest('base64url');
}

const corePair = generateKeyPairSync('ed25519');

/** PEM of Core's public key, the value of `JWT_PUBLIC_KEY`. */
export const JWT_PUBLIC_KEY = corePair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

/** A key pair the deployment does not trust (a compromised service signing its own tokens). */
export const foreignKeyPair = generateKeyPairSync('ed25519');

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export interface EddsaTokenOptions {
  /** Lifetime in seconds, negative for an expired token. */
  expiresIn?: number;
  /** Claims added to (or replacing) `sub`, `exp`, `iss` and `aud`. */
  claims?: Record<string, unknown>;
  /** Header fields added to (or replacing) `alg`, `typ` and `kid`. */
  header?: Record<string, unknown>;
  /** Signing key, Core's by default. */
  privateKey?: KeyObject;
}

/** A session token signed like Core signs it (EdDSA, `kid`, `iss`, `aud`). */
export function eddsaToken(sub: number | string, options: EddsaTokenOptions = {}): string {
  const { expiresIn = 3_600, claims = {}, header = {}, privateKey = corePair.privateKey } = options;
  const unsigned = `${base64url({ alg: 'EdDSA', typ: 'JWT', kid: keyId(corePair.publicKey), ...header })}.${base64url({
    sub: String(sub),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    ...claims,
  })}`;
  return `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

/** A historical HS256 session token signed with a shared secret: refused once `JWT_SECRET` is gone. */
export function hs256Token(sub: number | string, secret: string, expiresIn = 3_600): string {
  const unsigned = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: String(sub), exp: Math.floor(Date.now() / 1000) + expiresIn })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** Configures the BFF like a deployment after the transition: `JWT_PUBLIC_KEY` only, no `JWT_SECRET`. */
export function useSessionPublicKey(): void {
  process.env.JWT_PUBLIC_KEY = JWT_PUBLIC_KEY;
  delete process.env.JWT_SECRET;
}
