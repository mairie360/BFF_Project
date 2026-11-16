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
  // Articles and words that carry no accent (review of the MAIR-248 PRs: "Nom du contact" and
  // "Charge la page projets" went through with the list above alone).
  'de', 'du', 'le', 'la', 'au', 'aux', 'nom', 'fin', 'suivi', 'contenu', 'adresse',
  'initiales', 'dernier', 'heure', 'complet', 'affichable', 'supprime', 'personne',
  'identifiants', 'invalide', 'invalides', 'oui',
]);

/**
 * Every `summary` and `description` of the document, outside the examples. `properties` holds a
 * map of property name → schema: its keys are names (`example`, `description`, `properties`… are
 * valid property names), so each value is walked as a schema whatever its key.
 */
function texts(value: unknown, out: string[], isPropertyMap = false): string[] {
  if (Array.isArray(value)) value.forEach((item) => texts(item, out));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (isPropertyMap) texts(item, out);
      else if (key === 'example' || key === 'examples') return;
      else if ((key === 'summary' || key === 'description') && typeof item === 'string') out.push(item);
      else texts(item, out, key === 'properties');
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

  it('flags the French texts without accent found in review', () => {
    [
      'Nom du contact', 'Contenu du message', 'Description de la mention', 'Nom complet affichable',
      'Date de fin au format YYYY-MM-DD', 'Charge la page projets', 'Suivi collaboratif',
      'Force le changement de mot de passe', 'Configuration du footer', 'Identifiants invalides', 'Oui',
    ].forEach((text) => expect(isFrench(text)).toBe(true));
    expect(isFrench('End date (YYYY-MM-DD)')).toBe(false);
    expect(isFrench('Load the projects page')).toBe(false);
    // "charge" is English too.
    expect(isFrench('The user in charge of the project')).toBe(false);
  });

  it('checks a schema property named example, and skips example data', () => {
    const doc = {
      properties: { example: { type: 'string', description: 'Nom du contact' } },
      example: { name: 'Nom du contact' },
    };
    expect(texts(doc, [])).toEqual(['Nom du contact']);
    // A property named `properties`: its description is checked, its example data is not.
    const nested = {
      properties: { properties: { type: 'object', description: 'Nom du contact', example: { description: 'Exemple' } } },
    };
    expect(texts(nested, [])).toEqual(['Nom du contact']);
  });
});
