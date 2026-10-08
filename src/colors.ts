/** Couleurs nommées de Home Assistant (mêmes noms que le sélecteur `ui_color`). */
const HA_COLORS: Record<string, string> = {
  primary: 'var(--primary-color)',
  accent: 'var(--accent-color)',
  red: '#f44336',
  pink: '#e91e63',
  purple: '#926bc7',
  'deep-purple': '#6e41ab',
  indigo: '#3f51b5',
  blue: '#2196f3',
  'light-blue': '#03a9f4',
  cyan: '#00bcd4',
  teal: '#009688',
  green: '#4caf50',
  'light-green': '#8bc34a',
  lime: '#cddc39',
  yellow: '#ffeb3b',
  amber: '#ffc107',
  orange: '#ff9800',
  'deep-orange': '#ff6f22',
  brown: '#795548',
  'light-grey': '#bdbdbd',
  grey: '#9e9e9e',
  'dark-grey': '#606060',
  'blue-grey': '#607d8b',
  black: '#000000',
  white: '#ffffff',
  disabled: 'var(--disabled-color, #bdbdbd)',
};

/** Convertit une couleur de config en valeur CSS (nom HA → variable de thème avec repli). */
export function resolveColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const key = color.trim();
  if (key in HA_COLORS) {
    const value = HA_COLORS[key];
    return value.startsWith('var(') ? value : `var(--${key}-color, ${value})`;
  }
  return key;
}

/**
 * Palette par défaut : couleurs système iOS, définies en variables CSS dans les styles de la carte
 * (avec leurs variantes sombres) et surchargeables par le thème.
 */
export const DEFAULT_COLORS = {
  solar: 'var(--pf-solar)',
  gridImport: 'var(--pf-grid)',
  gridExport: 'var(--pf-export)',
  battery: 'var(--pf-battery)',
  batteryCharge: 'var(--pf-battery)',
  home: 'var(--pf-home)',
  device: 'var(--pf-device)',
};
