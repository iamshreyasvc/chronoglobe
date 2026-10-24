export type Category =
  | 'war'
  | 'battle'
  | 'politics'
  | 'unrest'
  | 'disaster'
  | 'disease'
  | 'violence'
  | 'exploration'
  | 'other'

export interface HistEvent {
  /** Wikidata Q-id, e.g. "Q4440" */
  id: string
  /** English Wikipedia article title */
  title: string
  /** ISO-like Wikidata timestamp, e.g. "-0479-08-06T00:00:00Z" */
  date: string
  /** Astronomical year: 0 = 1 BCE, -479 = 480 BCE */
  year: number
  lat: number
  lon: number
  category: Category
  /** Number of Wikipedia language editions, used as an importance signal */
  sitelinks: number
}

export interface YearRange {
  from: number
  to: number
}
