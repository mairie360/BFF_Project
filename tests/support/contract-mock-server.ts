import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenApiContract } from './openapi-contract';

// Faux service amont servi en HTTP réel : chaque requête reçue est vérifiée contre le contrat
// OpenAPI du service simulé (chemin, méthode, paramètres, corps JSON), et chaque réponse mockée
// est validée contre le schéma du statut renvoyé. Les écarts sont collectés dans `violations`.

export type RecordedRequest = {
  method: string;
  url: URL;
  /** Chemin tel que déclaré dans le contrat (préfixe `basePath` retiré). */
  path: string;
  template: string;
  pathParams: Record<string, string>;
  headers: IncomingHttpHeaders;
  undeclaredQuery: string[];
  body?: unknown;
};

export type MockReply = {
  status?: number;
  body?: unknown;
  /** Corps brut envoyé tel quel (ex. JSON invalide, text/plain). */
  raw?: string;
  contentType?: string;
  /** En-têtes de réponse supplémentaires (ex. `Authorization` renvoyé par un login). */
  headers?: Record<string, string>;
  /** Coupe la connexion sans répondre (panne réseau simulée). */
  dropConnection?: boolean;
  /** Autorise volontairement une réponse hors contrat (statut non documenté, corps non conforme). */
  outOfContract?: boolean;
};

type Handler = (request: RecordedRequest) => MockReply;

export type ContractMockOptions = {
  /** Préfixe de montage absent des chemins du contrat (ex. `/api` pour les API Rust). */
  basePath?: string;
  /** Chemins du contrat servis hors `basePath` (ex. `/health`). */
  rootPaths?: string[];
};

export class ContractMockServer {
  readonly requests: RecordedRequest[] = [];
  readonly violations: string[] = [];
  private readonly handlers = new Map<string, Handler>();
  private readonly deviations: Array<{ pattern: RegExp; reason: string }> = [];
  private server?: http.Server;
  url = '';

  constructor(
    public readonly service: string,
    public readonly contract: OpenApiContract,
    private readonly options: ContractMockOptions = {},
  ) {}

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        // Une exception dans le mock ne doit pas tuer Jest : elle devient une violation.
        this.violations.push(`[${this.service}] erreur du mock : ${error instanceof Error ? error.message : String(error)}`);
        send(res, 500, JSON.stringify({ error: { message: 'Erreur du mock' } }));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  /** Enregistre un handler ; le couple méthode/chemin doit exister dans le contrat amont. */
  on(method: string, template: string, handler: Handler | MockReply): this {
    if (!this.contract.document.paths[template]?.[method.toLowerCase()]) {
      throw new Error(`${method} ${template} n'est pas déclaré dans le contrat ${this.contract.title}`);
    }
    this.handlers.set(`${method.toUpperCase()} ${template}`, typeof handler === 'function' ? handler : () => handler);
    return this;
  }

  /**
   * Accepte un écart connu entre le contrat publié et le comportement réel du service amont.
   * Chaque exception doit être justifiée : elle signale un contrat amont à corriger.
   */
  allowDeviation(pattern: RegExp, reason: string): this {
    if (!reason.trim()) throw new Error('Un écart de contrat accepté doit être justifié');
    this.deviations.push({ pattern, reason });
    return this;
  }

  reset(): void {
    this.requests.length = 0;
    this.violations.length = 0;
    this.handlers.clear();
  }

  calls(template: string, method?: string): RecordedRequest[] {
    return this.requests.filter((request) => request.template === template && (!method || request.method === method.toUpperCase()));
  }

  private violation(message: string) {
    if (!this.deviations.some(({ pattern }) => pattern.test(message))) this.violations.push(message);
  }

  private contractPath(pathname: string): string | undefined {
    const { basePath = '', rootPaths = [] } = this.options;
    if (!basePath || rootPaths.includes(pathname)) return pathname;
    return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', this.url);
    const rawBody = await readBody(req);
    const path = this.contractPath(url.pathname);
    const { match, errors, undeclaredQuery } = path === undefined
      ? { match: undefined, errors: [`hors du préfixe ${this.options.basePath}`], undeclaredQuery: [] }
      : this.contract.validateRequest(method, new URL(`${path}${url.search}`, this.url));
    errors.forEach((error) => this.violation(`[${this.service}] requête ${method} ${url.pathname}${url.search} : ${error}`));
    if (!match || path === undefined) return send(res, 404, JSON.stringify({ error: { message: 'Route absente du contrat' } }));

    let body: unknown;
    const { required, schema: bodySchema } = this.contract.requestBodySchema(match);
    if (rawBody) {
      try { body = JSON.parse(rawBody); } catch { this.violation(`[${this.service}] requête ${method} ${match.template} : corps JSON invalide`); }
    } else if (required) {
      this.violation(`[${this.service}] requête ${method} ${match.template} : corps requis manquant`);
    }
    if (bodySchema && body !== undefined) {
      this.contract.validate(bodySchema, body, '$body').forEach((error) => this.violation(`[${this.service}] requête ${method} ${match.template} ${error}`));
    }

    const request: RecordedRequest = { method, url, path, template: match.template, pathParams: match.pathParams, headers: req.headers, undeclaredQuery, body };
    this.requests.push(request);
    const handler = this.handlers.get(`${method} ${match.template}`);
    if (!handler) {
      this.violations.push(`[${this.service}] appel non mocké : ${method} ${match.template}`);
      return send(res, 500, JSON.stringify({ error: { message: 'Appel non mocké' } }));
    }

    const reply = handler(request);
    if (reply.dropConnection) return void req.socket.destroy();
    const status = reply.status ?? 200;
    if (!reply.outOfContract) {
      const { documented, schema } = this.contract.responseSchema(match, status);
      if (!documented) this.violation(`[${this.service}] ${method} ${match.template} : statut ${status} non documenté`);
      if (schema && reply.raw === undefined) {
        this.contract.validate(schema, reply.body).forEach((error) => this.violation(`[${this.service}] réponse ${status} ${method} ${match.template} ${error}`));
      }
    }
    return send(res, status, reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body)), reply.contentType, reply.headers);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: string, contentType = 'application/json', headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...(payload ? { 'Content-Type': contentType } : {}), ...headers });
  res.end(payload);
}

/** Retourne une URL sur laquelle rien n'écoute (port libéré juste après attribution). */
export async function unreachableUrl(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}
