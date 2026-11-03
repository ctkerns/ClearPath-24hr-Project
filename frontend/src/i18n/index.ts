import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/en/common.json'

// All interface text comes from the files in ./locales/<language>/.
// To add a language: copy locales/en, translate the values, and add it to `resources`.
// Text inside reviewed marketing materials is content, not interface text; never translate it.

export const defaultNS = 'common'

export const resources = {
  en: { common },
} as const

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS,
  ns: [defaultNS],
  resources,
  interpolation: { escapeValue: false }, // React already escapes output
})

// Screen readers and the browser's hyphenation use the page language
document.documentElement.lang = i18n.language
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

export default i18n
