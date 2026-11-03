import 'i18next'
import type { defaultNS, resources } from './index'

// Makes t('nav.dashboard') type-checked: a missing or misspelled key is a compile error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS
    resources: (typeof resources)['en']
  }
}
