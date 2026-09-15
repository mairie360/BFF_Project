import { readFileSync } from 'node:fs';

// Lecture des contrats OpenAPI 3.1 des services amont et validation JSON Schema minimale.
// Le validateur ne couvre que les mots-clés émis par zod-to-openapi dans les contrats
// Mairie360 : tout mot-clé inconnu fait échouer la validation plutôt que d'être ignoré.

export type JsonSchema = { [keyword: string]: unknown };
type Operation = {
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: JsonSchema }>;
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
  responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>;
};
type OpenApiDocument = {
  info: { title: string };
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, JsonSchema> };
};
export type MatchedOperation = { template: string; operation: Operation; pathParams: Record<string, string> };

const ANNOTATIONS = new Set(['description', 'example', 'examples', 'default', 'title', 'deprecated', 'readOnly', 'writeOnly']);
const HANDLED = new Set([
  '$ref', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'allOf', 'oneOf',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format',
]);

export class OpenApiContract {
  constructor(public readonly document: OpenApiDocument) {}

  static load(file: string): OpenApiContract {
    return new OpenApiContract(JSON.parse(readFileSync(file, 'utf8')) as OpenApiDocument);
  }

  get title() { return this.document.info.title; }

  /** Trouve l'opération correspondant à un chemin concret (les chemins littéraux priment). */
  match(method: string, pathname: string): MatchedOperation | undefined {
    const templates = Object.keys(this.document.paths)
      .sort((a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0));
    for (const template of templates) {
      const names: string[] = [];
      const pattern = template.split(/(\{[^}]+\})/).map((part) => {
        if (!part.startsWith('{')) return part.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
        names.push(part.slice(1, -1));
        return '([^/]+)';
      }).join('');
      const found = new RegExp(`^${pattern}$`).exec(pathname);
      const operation = this.document.paths[template][method.toLowerCase()];
      if (found && operation) {
        return { template, operation, pathParams: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1])])) };
      }
    }
    return undefined;
  }

  /** Vérifie qu'une requête sortante du BFF correspond à une opération déclarée. */
  validateRequest(method: string, url: URL): { match?: MatchedOperation; errors: string[]; undeclaredQuery: string[] } {
    const match = this.match(method, url.pathname);
    if (!match) return { errors: [`${method} ${url.pathname} n'existe pas dans le contrat ${this.title}`], undeclaredQuery: [] };
    const errors: string[] = [];
    const parameters = match.operation.parameters ?? [];
    for (const parameter of parameters) {
      const raw = parameter.in === 'path' ? match.pathParams[parameter.name]
        : parameter.in === 'query' ? url.searchParams.get(parameter.name) ?? undefined : undefined;
      if (parameter.in !== 'path' && parameter.in !== 'query') continue;
      if (raw === undefined) {
        if (parameter.required) errors.push(`paramètre ${parameter.in} "${parameter.name}" requis manquant`);
        continue;
      }
      if (parameter.schema) {
        const value = coerceParameter(raw, parameter.schema);
        errors.push(...this.validate(parameter.schema, value, `${parameter.in}.${parameter.name}`));
      }
    }
    const declared = new Set(parameters.filter((p) => p.in === 'query').map((p) => p.name));
    const undeclaredQuery = [...new Set(url.searchParams.keys())].filter((name) => !declared.has(name));
    return { match, errors, undeclaredQuery };
  }

  /** Statuts documentés (code exact, sinon plage `2XX`…) et schéma JSON de la réponse pour un statut donné. */
  responseSchema(match: MatchedOperation, status: number): { documented: boolean; schema?: JsonSchema } {
    const responses = match.operation.responses ?? {};
    const response = responses[String(status)] ?? responses[`${String(status)[0]}XX`];
    return { documented: response !== undefined, schema: response?.content?.['application/json']?.schema };
  }

  /** Schéma JSON du corps de requête attendu par l'opération. */
  requestBodySchema(match: MatchedOperation): { required: boolean; schema?: JsonSchema } {
    const body = match.operation.requestBody;
    return { required: Boolean(body?.required), schema: body?.content?.['application/json']?.schema };
  }

  schema(name: string): JsonSchema {
    const schema = this.document.components?.schemas?.[name];
    if (!schema) throw new Error(`Schéma ${name} absent du contrat ${this.title}`);
    return schema;
  }

  validate(schema: JsonSchema, value: unknown, at = '$'): string[] {
    for (const keyword of Object.keys(schema)) {
      if (!HANDLED.has(keyword) && !ANNOTATIONS.has(keyword)) {
        throw new Error(`Mot-clé JSON Schema non supporté par le validateur de test : ${keyword} (${at})`);
      }
    }
    if (typeof schema.$ref === 'string') return this.validate(this.resolve(schema.$ref), value, at);

    const errors: string[] = [];
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
      if (!types.some((type) => hasType(value, type))) {
        return [`${at}: type ${types.join('|')} attendu, reçu ${describe(value)}`];
      }
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
      errors.push(`${at}: valeur ${JSON.stringify(value)} hors enum ${JSON.stringify(schema.enum)}`);
    }
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf as JsonSchema[]) errors.push(...this.validate(sub, value, at));
    }
    if (Array.isArray(schema.anyOf) && !(schema.anyOf as JsonSchema[]).some((sub) => this.validate(sub, value, at).length === 0)) {
      errors.push(`${at}: aucune alternative anyOf ne correspond à ${describe(value)}`);
    }
    if (Array.isArray(schema.oneOf) && (schema.oneOf as JsonSchema[]).filter((sub) => this.validate(sub, value, at).length === 0).length !== 1) {
      errors.push(`${at}: exactement une alternative oneOf doit correspondre à ${describe(value)}`);
    }
    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${at}: ${value} < minimum ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${at}: ${value} > maximum ${schema.maximum}`);
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errors.push(`${at}: ${value} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) errors.push(`${at}: ${value} >= exclusiveMaximum ${schema.exclusiveMaximum}`);
    }
    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${at}: longueur < ${schema.minLength}`);
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${at}: longueur > ${schema.maxLength}`);
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: "${value}" ne respecte pas ${schema.pattern}`);
      if (typeof schema.format === 'string' && !matchesFormat(value, schema.format)) errors.push(`${at}: "${value}" n'est pas au format ${schema.format}`);
    }
    if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => errors.push(...this.validate(schema.items as JsonSchema, item, `${at}[${index}]`)));
    }
    if (isObject(value)) {
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      for (const name of (schema.required ?? []) as string[]) {
        if (!(name in value)) errors.push(`${at}.${name}: propriété requise manquante`);
      }
      for (const [name, propertyValue] of Object.entries(value)) {
        if (properties[name]) errors.push(...this.validate(properties[name], propertyValue, `${at}.${name}`));
        else if (schema.additionalProperties === false) errors.push(`${at}.${name}: propriété non autorisée`);
        else if (isObject(schema.additionalProperties)) errors.push(...this.validate(schema.additionalProperties, propertyValue, `${at}.${name}`));
      }
    }
    return errors;
  }

  private resolve(ref: string): JsonSchema {
    const prefix = '#/components/schemas/';
    if (!ref.startsWith(prefix)) throw new Error(`$ref non supportée : ${ref}`);
    return this.schema(ref.slice(prefix.length));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return isObject(value);
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: return typeof value === type;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesFormat(value: string, format: string): boolean {
  switch (format) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'uri': try { new URL(value); return true; } catch { return false; }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'date-time': return !Number.isNaN(Date.parse(value));
    default: return true;
  }
}

/** Les paramètres de chemin/query arrivent en chaîne : conversion selon le type déclaré. */
function coerceParameter(raw: string, schema: JsonSchema): unknown {
  const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type];
  if ((types.includes('number') || types.includes('integer')) && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  if (types.includes('boolean') && (raw === 'true' || raw === 'false')) return raw === 'true';
  return raw;
}
