import english from './locales/en.js';

export const DEFAULT_LOCALE = 'en';
// An explicit allowlist keeps browser preferences out of module paths.
const loaders = {
  en: async () => ({ default: english }),
  ko: () => import('./locales/ko.js'),
  ja: () => import('./locales/ja.js'),
  'zh-Hans': () => import('./locales/zh-Hans.js'),
  'zh-Hant': () => import('./locales/zh-Hant.js'),
};
export const SUPPORTED_LOCALES = Object.freeze(Object.keys(loaders));

export function resolveLocale(languages = []) {
  for (const tag of languages) {
    if (typeof tag !== 'string' || !tag.trim()) continue;
    try {
      const { language, script, region } = new Intl.Locale(tag.trim().replaceAll('_', '-'));
      if (language === 'zh') {
        if (script === 'Hant') return 'zh-Hant';
        if (script === 'Hans') return 'zh-Hans';
        return ['TW', 'HK', 'MO'].includes(region) ? 'zh-Hant' : 'zh-Hans';
      }
      if (Object.hasOwn(loaders, language)) return language;
    } catch { /* Ignore invalid language tags and try the next preference. */ }
  }
  return DEFAULT_LOCALE;
}

export function createTranslator(messages) {
  return (key, params = {}) => {
    const value = Object.hasOwn(messages, key) && typeof messages[key] === 'string'
      ? messages[key] : english[key];
    if (typeof value !== 'string') throw new Error(`Unknown locale key: ${key}`);
    return value.replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder);
  };
}

export async function loadLocale(languages, load = locale => loaders[locale]()) {
  let locale = resolveLocale(languages);
  let messages;
  try {
    messages = (await load(locale)).default;
    if (!messages || typeof messages !== 'object') throw new Error('Invalid locale');
  } catch {
    locale = DEFAULT_LOCALE;
    messages = english;
  }
  return { locale, t: createTranslator(messages), number: new Intl.NumberFormat(locale) };
}

export function applyTranslations(root, t, params = {}) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n, params);
  }
  for (const attribute of ['aria-label', 'content']) {
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`), params));
    }
  }
}
