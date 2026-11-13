import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../data/db'
import { createList, updateListMeta } from '../data/lists'
import ListCollage from './ListCollage'
import type { CustomList } from '../data/types'

/**
 * A single list card: its custom poster when set, otherwise a collage of member
 * posters as the fallback — plus the name + title count. A star toggle in the
 * corner pins the list to the Library's Favorites section.
 */
function ListCard({ list, onOpen }: { list: CustomList; onOpen: () => void }) {
  return (
    <div className="list-card-cell">
      <button type="button" className="list-card" onClick={onOpen} title={list.name}>
        {list.poster ? (
          <img className="list-card__cover" src={list.poster} alt="" loading="lazy" />
        ) : (
          <ListCollage items={list.items} />
        )}
        <span className="list-card__name">{list.name}</span>
        <span className="list-card__count muted">
          {list.items.length} {list.items.length === 1 ? 'title' : 'titles'}
        </span>
      </button>
      <button
        className={`fav-star${list.favorite ? ' fav-star--on' : ''}`}
        title={list.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
        aria-label={list.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
        onClick={() => void updateListMeta(list.id, { favorite: !list.favorite })}
      >
        {list.favorite ? '★' : '☆'}
      </button>
    </div>
  )
}

/**
 * Stats "Lists" section: a row of the user's custom lists (poster collages) plus
 * a "＋ New list" card. Opening a list routes to /list/:id; the new-list button
 * creates an empty list and jumps straight into it.
 */
export default function ListsSection() {
  const lists = useLiveQuery(() => db.lists.orderBy('updatedAt').reverse().toArray(), [])
  const navigate = useNavigate()

  async function newList() {
    const list = await createList()
    navigate(`/list/${list.id}`)
  }

  return (
    <section className="card">
      <h3 className="section-title">Lists</h3>
      <div className="lists-row hscroll">
        {(lists ?? []).map((list) => (
          <ListCard key={list.id} list={list} onOpen={() => navigate(`/list/${list.id}`)} />
        ))}
        <button
          type="button"
          className="list-card list-card--new"
          onClick={() => void newList()}
          title="Create a new list"
        >
          <span className="list-card__plus" aria-hidden="true">
            +
          </span>
          <span className="list-card__name">New list</span>
        </button>
      </div>
    </section>
  )
}
