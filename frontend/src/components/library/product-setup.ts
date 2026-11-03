import type { Product } from './product-data'

// What a product needs before its materials get a full review (PRD F8, US-66). A new product, for example auto
// loans, starts with none of these. Nothing here blocks a submission: rules for every product still apply, and the
// default group still reviews. The list tells the Manager what is still missing, so the first review is not a surprise.

export type SetupStep = {
  key: 'rules' | 'disclosures' | 'rateSheet' | 'routing'
  done: boolean
  count: number
  /** Without it, checks can fail on every material of the product (a rate that is not on the sheet). */
  blocking: boolean
}

export function setupSteps(p: Product): SetupStep[] {
  const u = p.usage
  return [
    { key: 'rules', done: u.rules > 0, count: u.rules, blocking: false },
    { key: 'disclosures', done: u.disclosures > 0, count: u.disclosures, blocking: false },
    // The rate check fails every rate that is not on the current sheet for the product (F8).
    { key: 'rateSheet', done: u.rateSheetRows > 0, count: u.rateSheetRows, blocking: true },
    { key: 'routing', done: u.routingRules > 0, count: u.routingRules, blocking: false },
  ]
}

/** Steps still to do, for the "2 steps left" line on the list. */
export const stepsLeft = (p: Product) => setupSteps(p).filter((s) => !s.done).length
