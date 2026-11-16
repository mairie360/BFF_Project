// MAIR-248: the contract the fronts read (`contracts/openapi.json`, published as
// `@mairie360/bff-*-openapi`) is written in English. Fails on any French text that comes back
// into a summary or a description. Examples are left out: they mirror the data the BFF returns,
// whose labels are shown to French users as they are.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** French texts kept on purpose, removed before the check. */
const ALLOWED: string[] = [];

const FRENCH_WORDS = new Set([
  'les', 'des', 'une', 'est', 'pour', 'avec', 'sans', 'dans', 'aucun', 'aucune', 'identifiant',
  'utilisateur', 'requête', 'erreur', 'corps', 'chemin', 'récupère', 'liste',
]);

/** Every `summary` and `description` of the document, outside the examples. */
function texts(value: unknown, out: string[]): string[] {
  if (Array.isArray(value)) value.forEach((item) => texts(item, out));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (key === 'example' || key === 'examples') return;
      if ((key === 'summary' || key === 'description') && typeof item === 'string') out.push(item);
      else texts(item, out);
    });
  }
  return out;
}

export function isFrench(text: string): boolean {
  const rest = ALLOWED.reduce((acc, allowed) => acc.split(allowed).join(''), text);
  return /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊÎÔÛ]/.test(rest)
    || rest.split(/[^\p{L}\p{N}]+/u).some((word) => FRENCH_WORDS.has(word.toLowerCase()));
}

describe('MAIR-248 contract language', () => {
  it('has no French text in contracts/openapi.json', () => {
    const contract = JSON.parse(readFileSync(join(__dirname, '..', 'contracts', 'openapi.json'), 'utf8'));
    expect(texts(contract, []).filter(isFrench)).toEqual([]);
  });

  it('flags French text', () => {
    expect(isFrench('Liste des conversations')).toBe(true);
    expect(isFrench('Récupère le profil')).toBe(true);
    expect(isFrench('List the conversations')).toBe(false);
  });
});
