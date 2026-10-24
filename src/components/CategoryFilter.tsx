import type { Category } from '../types'
import { CATEGORIES, CATEGORY_META } from '../lib/categories'

interface Props {
  enabled: Set<Category>
  counts: Record<Category, number>
  onToggle: (c: Category) => void
}

export function CategoryFilter({ enabled, counts, onToggle }: Props) {
  return (
    <div className="chips" role="group" aria-label="Event categories">
      {CATEGORIES.map((c) => {
        const on = enabled.has(c)
        return (
          <button
            key={c}
            className={`glass-chip category-chip${on ? '' : ' is-off'}`}
            aria-pressed={on}
            onClick={() => onToggle(c)}
            style={{ '--chip': CATEGORY_META[c].color } as React.CSSProperties}
          >
            <span className="dot" />
            {CATEGORY_META[c].label}
            <span className="chip-count">{counts[c] ?? 0}</span>
          </button>
        )
      })}
    </div>
  )
}
