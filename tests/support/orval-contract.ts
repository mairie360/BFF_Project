import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { OpenApiContract, type JsonSchema } from './openapi-contract';

// Reconstruit le contrat OpenAPI d'une API Rust à partir de son paquet @mairie360/*-api-openapi installé
// (sortie orval : endpoints/*.ts + model/*.ts). La version testée est donc celle épinglée par
// package-lock.json, sans copie locale à maintenir.
//
// Ce que la sortie orval ne conserve pas, et que ces contrats ne peuvent donc pas vérifier :
// - seuls les statuts de succès sont typés : ils sont exposés sous la plage `2XX`, les erreurs ne sont
//   pas documentées (un mock qui renvoie une erreur doit le déclarer avec `outOfContract: true`) ;
// - les formats (date-time, int64) disparaissent et les entiers deviennent des `number` ;
// - les noms de paramètres de chemin sont ceux d'orval (`{eventId}` au lieu de `{event_id}`).
// Les contraintes JSDoc (`@minimum`, `@maximum`, `@exclusiveMinimum`, `@minLength`, `@maxLength`, `@pattern`,
// y compris `@items.*`), `@nullable`, les champs optionnels et les enums sont conservés.

type Parameter = { name: string; in: 'path' | 'query'; required: boolean; schema: JsonSchema };
type Operation = {
  operationId: string;
  parameters: Parameter[];
  requestBody?: { required: boolean; content: Record<string, { schema: JsonSchema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: JsonSchema }> }>;
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

export type OrvalPackage = { name: string; version: string; dir: string };

export function resolveOrvalPackage(packageName: string): OrvalPackage {
  const dir = path.dirname(require.resolve(`${packageName}/package.json`));
  const { name, version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name: string; version: string };
  return { name, version, dir };
}

export function loadOrvalContract(packageName: string): OpenApiContract {
  const pkg = resolveOrvalPackage(packageName);
  const models = readModels(path.join(pkg.dir, 'model'));
  const paths: Record<string, Record<string, Operation>> = {};
  let title = pkg.name;

  for (const file of tsFiles(path.join(pkg.dir, 'endpoints'))) {
    const source = parse(file);
    title = /\*\s*(\S+)\s*\n\s*\*\s*OpenAPI spec version/.exec(source.text)?.[1] ?? title;
    visit(source, (node) => {
      if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isArrowFunction(node.initializer)) return;
      const operation = readOperation(node.name.getText(), node.initializer, models);
      if (!operation) return;
      paths[operation.template] ??= {};
      paths[operation.template][operation.method] = operation.operation;
    });
  }

  if (Object.keys(paths).length === 0) throw new Error(`Aucune opération orval trouvée dans ${pkg.name}@${pkg.version}`);
  return new OpenApiContract({ info: { title }, paths, components: { schemas: models.schemas } } as ConstructorParameters<typeof OpenApiContract>[0]);
}

type Models = {
  /** Interfaces et enums : schémas de composants OpenAPI. */
  schemas: Record<string, JsonSchema>;
  /**
   * Alias `type X = {...}` : paramètres de requête d'une opération, ou schéma objet de composant. Quand une
   * interface porte le même nom (ex. GetCalendarParams), l'interface est le composant et l'alias les paramètres.
   */
  aliases: Record<string, JsonSchema>;
};

function readModels(dir: string): Models {
  const models: Models = { schemas: {}, aliases: {} };
  for (const file of tsFiles(dir)) {
    const source = parse(file);
    const enumValues = new Map<string, string[]>();
    const enumAliases: string[] = [];

    for (const statement of source.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        models.schemas[statement.name.text] = objectSchema(statement.members);
      } else if (ts.isTypeAliasDeclaration(statement)) {
        if (ts.isTypeLiteralNode(statement.type)) {
          models.aliases[statement.name.text] = objectSchema(statement.type.members);
          models.schemas[statement.name.text] ??= models.aliases[statement.name.text];
        }
        else if (ts.isIndexedAccessTypeNode(statement.type)) enumAliases.push(statement.name.text);
        else models.schemas[statement.name.text] ??= typeSchema(statement.type);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer && ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : undefined;
          if (initializer && ts.isObjectLiteralExpression(initializer)) {
            enumValues.set(declaration.name.getText(), initializer.properties
              .filter(ts.isPropertyAssignment)
              .map((property) => (ts.isStringLiteral(property.initializer) ? property.initializer.text : property.initializer.getText())));
          }
        }
      }
    }

    // `export type X = typeof X[keyof typeof X]` + `export const X = {...} as const` : enum orval.
    for (const name of enumAliases) {
      const values = enumValues.get(name);
      if (!values) throw new Error(`Enum orval ${name} sans constante associée (${file})`);
      models.schemas[name] = { type: 'string', enum: values };
    }
  }
  return models;
}

function readOperation(operationId: string, fn: ts.ArrowFunction, models: Models) {
  // Opération orval : `const x = (...): Promise<AxiosResponse<T>> => axiosInstance.<méthode>(...)`.
  // La fabrique `getXApi` et les helpers `getXUrl` n'ont pas ce type de retour.
  if (!fn.type || !/^Promise<AxiosResponse</.test(fn.type.getText())) return undefined;
  let call: ts.CallExpression | undefined;
  visit(fn.body, (node) => {
    if (call || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.expression.getText() === 'axiosInstance' && HTTP_METHODS.has(node.expression.name.text)) call = node;
  });
  if (!call) return undefined;

  const method = (call.expression as ts.PropertyAccessExpression).name.text;
  const fnParameters = new Map(fn.parameters.map((parameter) => [parameter.name.getText(), parameter]));
  const [urlArgument, secondArgument] = call.arguments;
  const pathNames: string[] = [];
  let template: string;
  if (ts.isNoSubstitutionTemplateLiteral(urlArgument) || ts.isStringLiteral(urlArgument)) {
    template = urlArgument.text;
  } else if (ts.isTemplateExpression(urlArgument)) {
    template = urlArgument.head.text + urlArgument.templateSpans.map((span) => {
      pathNames.push(span.expression.getText());
      return `{${span.expression.getText()}}${span.literal.text}`;
    }).join('');
  } else {
    throw new Error(`URL orval non littérale pour ${operationId}`);
  }

  const parameters: Parameter[] = pathNames.map((name) => ({
    name, in: 'path', required: true, schema: parameterType(fnParameters.get(name), operationId),
  }));

  const queryType = fnParameters.get('params')?.type;
  if (queryType) {
    const name = queryType.getText();
    const query = models.aliases[name] ?? models.schemas[name];
    if (!query) throw new Error(`Paramètres de requête ${name} introuvables pour ${operationId}`);
    const required = new Set((query.required ?? []) as string[]);
    for (const [queryName, schema] of Object.entries((query.properties ?? {}) as Record<string, JsonSchema>)) {
      parameters.push({ name: queryName, in: 'query', required: required.has(queryName), schema });
    }
  }

  // Corps : 2e argument pour post/put/patch, option `data` pour delete.
  let bodyName: string | undefined;
  if (['post', 'put', 'patch'].includes(method) && secondArgument && ts.isIdentifier(secondArgument)) bodyName = secondArgument.text;
  visit(call, (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'data' && ts.isIdentifier(node.initializer)) bodyName = node.initializer.text;
  });
  const bodyParameter = bodyName ? fnParameters.get(bodyName) : undefined;

  const responseType = withoutVoid(successType(fn.type, operationId));
  const isText = /responseType:\s*'text'/.test(call.getText());
  const responseSchema = responseType ? typeSchema(responseType) : undefined;

  const operation: Operation = {
    operationId,
    parameters,
    responses: {
      '2XX': {
        description: 'Succès (seul statut typé par orval)',
        ...(responseSchema ? { content: { [isText ? 'text/plain' : 'application/json']: { schema: responseSchema } } } : {}),
      },
    },
  };
  if (bodyParameter?.type) {
    operation.requestBody = { required: !bodyParameter.questionToken, content: { 'application/json': { schema: typeSchema(bodyParameter.type) } } };
  }
  return { method, template, operation };
}

function parameterType(parameter: ts.ParameterDeclaration | undefined, operationId: string): JsonSchema {
  if (!parameter?.type) throw new Error(`Type de paramètre de chemin absent pour ${operationId}`);
  return typeSchema(parameter.type);
}

/**
 * Retire `void` d'un type de réponse (`T | void` : corps éventuellement vide) ; `undefined` si seul `void` reste.
 * Un corps vide n'est jamais validé par le mock, seul un corps JSON présent l'est.
 */
function withoutVoid(node: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (!node || node.kind === ts.SyntaxKind.VoidKeyword) return undefined;
  if (!ts.isUnionTypeNode(node)) return node;
  const members = node.types.filter((member) => member.kind !== ts.SyntaxKind.VoidKeyword);
  if (members.length === 0) return undefined;
  return members.length === 1 ? members[0] : ts.factory.createUnionTypeNode(members);
}

/** `Promise<AxiosResponse<T>>` -> `T`. */
function successType(node: ts.TypeNode | undefined, operationId: string): ts.TypeNode | undefined {
  const promise = node && ts.isTypeReferenceNode(node) ? node.typeArguments?.[0] : undefined;
  const response = promise && ts.isTypeReferenceNode(promise) && promise.typeName.getText() === 'AxiosResponse' ? promise.typeArguments?.[0] : undefined;
  if (!response) throw new Error(`Type de retour orval inattendu pour ${operationId}`);
  return response;
}

function objectSchema(members: ts.NodeArray<ts.TypeElement>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const name = member.name.getText().replace(/^['"]|['"]$/g, '');
    const schema = typeSchema(member.type);
    applyConstraints(schema, member);
    properties[name] = schema;
    if (!member.questionToken) required.push(name);
  }
  return { type: 'object', properties, required };
}

const NUMBER_CONSTRAINTS = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']);
const STRING_CONSTRAINTS = new Set(['minLength', 'maxLength', 'pattern']);

/** Reporte les contraintes JSDoc d'orval (`@minimum 0`, `@items.maximum 6`, `@pattern ^...$`) sur le schéma. */
function applyConstraints(schema: JsonSchema, member: ts.PropertySignature) {
  const jsDoc = ts.getJSDocCommentsAndTags(member).map((node) => node.getText()).join('\n');
  for (const [, items, keyword, rawValue] of jsDoc.matchAll(/@(items\.)?(\w+)[ \t]+(.+?)[ \t]*(?:\*\/)?[ \t]*$/gm)) {
    let target = schema;
    if (items) {
      if (schema.type !== 'array' || !schema.items) continue;
      target = schema.items as JsonSchema;
    }
    const types = Array.isArray(target.type) ? target.type : [target.type];
    if (NUMBER_CONSTRAINTS.has(keyword) && types.includes('number')) target[keyword] = Number(rawValue);
    else if (STRING_CONSTRAINTS.has(keyword) && types.includes('string')) target[keyword] = keyword === 'pattern' ? rawValue : Number(rawValue);
  }
}

function typeSchema(node: ts.TypeNode): JsonSchema {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword: return { type: 'string' };
    case ts.SyntaxKind.NumberKeyword: return { type: 'number' };
    case ts.SyntaxKind.BooleanKeyword: return { type: 'boolean' };
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.AnyKeyword: return {};
  }
  if (ts.isParenthesizedTypeNode(node)) return typeSchema(node.type);
  if (ts.isArrayTypeNode(node)) return { type: 'array', items: typeSchema(node.elementType) };
  if (ts.isTypeLiteralNode(node)) return objectSchema(node.members);
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { type: 'null' };
    if (ts.isStringLiteral(node.literal)) return { type: 'string', enum: [node.literal.text] };
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (name === 'Array' && node.typeArguments?.[0]) return { type: 'array', items: typeSchema(node.typeArguments[0]) };
    if (name === 'Record' && node.typeArguments?.[1]) return { type: 'object', additionalProperties: typeSchema(node.typeArguments[1]) };
    return { $ref: `#/components/schemas/${name}` };
  }
  if (ts.isIntersectionTypeNode(node)) return { allOf: node.types.map(typeSchema) };
  if (ts.isUnionTypeNode(node)) {
    const members = node.types.map(typeSchema);
    const simple = members.every((member) => Object.keys(member).length === 1 && typeof member.type === 'string');
    if (simple) return { type: [...new Set(members.map((member) => member.type as string))] };
    return { anyOf: members };
  }
  throw new Error(`Type orval non géré par le lecteur de contrat : ${node.getText()}`);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).filter((file) => file.endsWith('.ts')).sort().map((file) => path.join(dir, file));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2020, true);
}

function visit(node: ts.Node, callback: (node: ts.Node) => void) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
