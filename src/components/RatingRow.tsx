import { useState } from 'react'
import RatingStars from './RatingStars'

/** Your-rating (editable) + the TMDB average, shown side by side. Used in the
 *  consolidated actions section on the movie / show / episode detail pages. */
export default function RatingRow({
  userRating,
  average,
  canRate,
  onPick,
  onClear,
  emptyLabel = 'Add to library to rate',
}: {
  userRating?: number
  average: string
  canRate: boolean
  onPick: (n: number) => void
  onClear: () => void
  emptyLabel?: string
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="ratings-row">
      <div className="rating-col">
        <span className="rating-col__label">Your rating</span>
        {!canRate ? (
          <span className="muted">{emptyLabel}</span>
        ) : userRating !== undefined && !editing ? (
          <span className="rating-value">
            ★ {userRating}/10{' '}
            <button className="link-btn" onClick={() => setEditing(true)}>
              revise
            </button>
          </span>
        ) : (
          <RatingStars
            value={userRating}
            onPick={(n) => {
              onPick(n)
              setEditing(false)
            }}
            onClear={
              userRating !== undefined
                ? () => {
                    onClear()
                    setEditing(false)
                  }
                : undefined
            }
          />
        )}
      </div>
      <div className="rating-col">
        <span className="rating-col__label">Average</span>
        <span className="rating-value">{average}</span>
      </div>
    </div>
  )
}
