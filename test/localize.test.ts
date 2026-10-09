import { describe, expect, it } from 'vitest';
import { LANGUAGE_NAMES, localize, resolveLanguage, SUPPORTED_LANGUAGES } from '../src/localize/localize';
import { buildModel } from '../src/model';
import type { HomeAssistant } from '../src/types';

const hass = (language: string): HomeAssistant => ({
  states: {
    'sensor.grid': {
      entity_id: 'sensor.grid',
      state: '300',
      attributes: { unit_of_measurement: 'W' },
    },
  },
  language,
  locale: { language },
});

describe('resolveLanguage', () => {
  it('follows the Home Assistant user language by default', () => {
    expect(resolveLanguage(undefined, hass('fr'))).toBe('fr');
    expect(resolveLanguage('auto', hass('fr'))).toBe('fr');
  });

  it('prefers the user profile locale over the server language', () => {
    expect(resolveLanguage(undefined, { language: 'en', locale: { language: 'fr' } })).toBe('fr');
  });

  it('uses the language set in the card configuration', () => {
    expect(resolveLanguage('en', hass('fr'))).toBe('en');
    expect(resolveLanguage('fr', hass('en'))).toBe('fr');
  });

  it('falls back to English without Home Assistant', () => {
    expect(resolveLanguage(undefined, undefined)).toBe('en');
  });
});

describe('localize', () => {
  it('translates into every supported language', () => {
    expect(localize('en', 'node.grid')).toBe('Grid');
    expect(localize('fr', 'node.grid')).toBe('Réseau');
  });

  it('replaces every occurrence of a variable', () => {
    expect(localize('en', 'error.moved_to_units', { node: 'solar', field: 'entity' })).toBe(
      'solar.entity is now set on each unit: move it to solar.units.',
    );
  });

  it('handles regional variants and unknown languages', () => {
    expect(localize('fr-CA', 'node.home')).toBe('Maison');
    expect(localize('xx', 'node.home')).toBe('Home');
  });

  it('names every supported language', () => {
    for (const code of SUPPORTED_LANGUAGES) expect(LANGUAGE_NAMES[code]).toBeTruthy();
  });
});

describe('card language', () => {
  it('default labels follow the configured language', () => {
    const config = { type: 'custom:live-energy-card', grid: { entity: 'sensor.grid' } };
    const grid = (language?: string, ha = 'fr') =>
      buildModel({ ...config, language }, hass(ha)).nodes.find((n) => n.id === 'grid')!.name;
    expect(grid()).toBe('Réseau');
    expect(grid('en')).toBe('Grid');
    expect(grid('fr', 'en')).toBe('Réseau');
  });

  it('a custom name always wins', () => {
    const model = buildModel(
      { type: 'custom:live-energy-card', language: 'en', grid: { entity: 'sensor.grid', name: 'Linky' } },
      hass('fr'),
    );
    expect(model.nodes.find((n) => n.id === 'grid')!.name).toBe('Linky');
  });
});
