import type { Category } from '../types'

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  war: { label: 'Wars', color: '#ef4444' },
  battle: { label: 'Battles', color: '#f97316' },
  politics: { label: 'Treaties & politics', color: '#3b82f6' },
  unrest: { label: 'Revolutions & unrest', color: '#a855f7' },
  disaster: { label: 'Disasters', color: '#eab308' },
  disease: { label: 'Epidemics', color: '#22c55e' },
  violence: { label: 'Massacres & attacks', color: '#be123c' },
  exploration: { label: 'Exploration', color: '#06b6d4' },
  other: { label: 'Other events', color: '#cbd5e1' },
}

export const CATEGORIES = Object.keys(CATEGORY_META) as Category[]

/**
 * Wikidata classes (P31 targets) queried, mapped to UI categories.
 * Order matters: when an item is an instance of several classes, the first
 * matching entry here wins, so specific classes come before generic ones.
 */
export const CLASS_CATEGORY: [string, Category][] = [
  ['Q178561', 'battle'], // battle
  ['Q1261499', 'battle'], // naval battle
  ['Q188055', 'battle'], // siege
  ['Q2001676', 'battle'], // offensive
  ['Q645883', 'battle'], // military operation
  ['Q2380335', 'battle'], // airstrike
  ['Q1361229', 'battle'], // conquest
  ['Q3199915', 'violence'], // massacre
  ['Q2223653', 'violence'], // terrorist attack
  ['Q891854', 'violence'], // bomb attack
  ['Q1371150', 'violence'], // hostage taking
  ['Q198', 'war'], // war
  ['Q1006311', 'war'], // war of national liberation
  ['Q350604', 'war'], // armed conflict
  ['Q180684', 'war'], // conflict
  ['Q10931', 'unrest'], // revolution
  ['Q124757', 'unrest'], // riot
  ['Q273120', 'unrest'], // protest
  ['Q175331', 'unrest'], // demonstration
  ['Q131569', 'politics'], // treaty
  ['Q625994', 'politics'], // convention / conference
  ['Q209715', 'politics'], // coronation
  ['Q8016240', 'politics'], // trial
  ['Q7944', 'disaster'], // earthquake
  ['Q8068', 'disaster'], // flood
  ['Q8092', 'disaster'], // tropical cyclone
  ['Q168983', 'disaster'], // conflagration
  ['Q744913', 'disaster'], // aviation accident
  ['Q8065', 'disaster'], // natural disaster
  ['Q3839081', 'disaster'], // disaster
  ['Q12184', 'disease'], // pandemic
  ['Q44512', 'disease'], // epidemic
  ['Q3241045', 'disease'], // disease outbreak
  ['Q2401485', 'exploration'], // expedition
  ['Q815962', 'exploration'], // colonization
  ['Q13418847', 'other'], // historical event
  ['Q1190554', 'other'], // occurrence
]

const CLASS_RANK = new Map(CLASS_CATEGORY.map(([q], i) => [q, i]))

/** Pick the most specific category for a set of Wikidata class ids. */
export function categoryForClasses(qids: string[]): Category {
  let best = Infinity
  for (const q of qids) best = Math.min(best, CLASS_RANK.get(q) ?? Infinity)
  return best === Infinity ? 'other' : CLASS_CATEGORY[best][1]
}
