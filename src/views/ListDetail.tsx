import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { deleteList, removeFromList, updateListMeta } from '../data/lists'
import { imageUrl } from '../api/tmdb'
import { appConfirm } from '../utils/confirm'
import { LIST_BANNER_MAX, LIST_POSTER_MAX, resizeImageToDataUrl } from '../utils/image'
import ImageDrop, { UploadIcon } from '../components/ImageDrop'
import ListCollage from '../components/ListCollage'
import WatchNextPoster from '../components/WatchNextCard'
import { WATCH_NEXT_LINK, isWatchNextId } from '../data/watchNext'
import type { CustomList, ListItem } from '../data/types'

/** Image for a list item: a TMDB poster path, or a full logo URL for sports. */
function itemImage(it: ListItem): string | undefined {
  return it.mediaType === 'sport' ? it.poster : imageUrl(it.poster, 'w342')
}
function itemEmoji(it: ListItem): string {
  return it.mediaType === 'sport' ? '🏟️' : it.mediaType === 'movie' ? '🎬' : '📺'
}

/** Count pills ("2 movies", "1 show", "1 team") for the items in a list. */
function countPills(items: ListItem[]): string[] {
  const n = { movie: 0, show: 0, sport: 0 }
  for (const it of items) {
    if (isWatchNextId(it.id)) continue // the Watch Next shortcut isn't a title
    n[it.mediaType]++
  }
  const pills: string[] = []
  if (n.movie) pills.push(`${n.movie} movie${n.movie === 1 ? '' : 's'}`)
  if (n.show) pills.push(`${n.show} show${n.show === 1 ? '' : 's'}`)
  if (n.sport) pills.push(`${n.sport} team${n.sport === 1 ? '' : 's'}`)
  return pills
}

/**
 * A custom list's page. Mirrors the Episode-page hero: a backdrop, a top row with
 * "← Stats" + the Edit/Save pill, then a left poster and meta (name, count pills,
 * description). "Edit details" makes the name/description editable, shows a − on
 * each poster to remove it, and a ＋ card to add titles from Search. Both images
 * (backdrop + poster) are customizable; upload comes in the next phase.
 */
export default function ListDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const list = useLiveQuery(() => db.lists.get(id).then((r) => r ?? null), [id])

  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const bannerInputRef = useRef<HTMLInputElement>(null)

  if (list === undefined) return <p className="muted">Loading…</p>
  if (list === null) {
    return (
      <div className="placeholder">
        <p>List not found.</p>
        <Link to="/stats">← Back to Stats</Link>
      </div>
    )
  }

  const data: CustomList = list
  const count = data.items.length
  const pills = countPills(data.items)

  function startEdit(): void {
    setDraftName(data.name)
    setDraftDesc(data.description ?? '')
    setEditing(true)
  }
  async function save(): Promise<void> {
    await updateListMeta(data.id, { name: draftName, description: draftDesc })
    setEditing(false)
  }
  async function confirmDelete(): Promise<void> {
    const ok = await appConfirm(`Delete the list “${data.name}”? This can't be undone.`, {
      confirmLabel: 'Delete list',
      cancelLabel: 'Cancel',
    })
    if (ok) {
      await deleteList(data.id)
      navigate('/stats')
    }
  }
  // The poster is handled by <ImageDrop>; the backdrop is the hero background, so
  // it's handled here — dropped/picked files resize into the banner, and the whole
  // hero is a drop target in edit mode.
  async function uploadBanner(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const dataUrl = await resizeImageToDataUrl(file, LIST_BANNER_MAX.w, LIST_BANNER_MAX.h)
      await updateListMeta(data.id, { banner: dataUrl })
    } catch {
      // Ignore an unsupported/corrupt file.
    }
  }

  return (
    <div className="list-detail">
      <section
        className="hero list-hero"
        onDragOver={editing ? (e) => e.preventDefault() : undefined}
        onDrop={
          editing
            ? (e) => {
                e.preventDefault()
                void uploadBanner(e.dataTransfer.files?.[0])
              }
            : undefined
        }
      >
        {data.banner && <img className="hero__backdrop" src={data.banner} alt="" />}
        <div className="hero__overlay" />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void uploadBanner(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {editing && data.banner && (
          <button
            type="button"
            className="img-drop__remove list-backdrop-remove"
            title="Remove backdrop"
            aria-label="Remove backdrop"
            onClick={() => void updateListMeta(data.id, { banner: null })}
          >
            −
          </button>
        )}
        <div className="hero__topbar">
          {!editing && (
            <Link className="back-link" to="/stats">
              ← Stats
            </Link>
          )}
          {editing && !data.banner && (
            <button
              type="button"
              className="list-backdrop-drop"
              onClick={() => bannerInputRef.current?.click()}
              title="Upload backdrop"
            >
              <UploadIcon />
              <span className="img-drop__label">Backdrop</span>
              <span className="img-drop__hint">16:9 · ~1280×720 · ≤5 MB</span>
            </button>
          )}
          <div className="list-hero__actions">
            <button
              type="button"
              className="ext-link"
              onClick={() => (editing ? void save() : startEdit())}
            >
              {editing ? 'Save details' : 'Edit details'}
            </button>
            {editing && (
              <button
                type="button"
                className="ext-link list-hero__delete"
                onClick={() => void confirmDelete()}
              >
                Delete list
              </button>
            )}
          </div>
        </div>
        <div className="hero__body">
          <div className="list-poster">
            {editing ? (
              <ImageDrop
                value={data.poster}
                onChange={(v) => void updateListMeta(data.id, { poster: v })}
                maxW={LIST_POSTER_MAX.w}
                maxH={LIST_POSTER_MAX.h}
                label="Poster"
                hint="2:3 · ~600×900 · ≤5 MB"
                shapeClass="img-drop--poster"
              />
            ) : data.poster ? (
              <img className="hero__poster" src={data.poster} alt="" />
            ) : (
              <ListCollage items={data.items} className="list-poster-collage" />
            )}
          </div>
          <div className="hero__meta">
            {editing ? (
              <input
                className="list-hero__name-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="List name"
                aria-label="List name"
              />
            ) : (
              <h2 className="hero__title">{data.name}</h2>
            )}
            {pills.length > 0 && (
              <div className="hero__tags">
                {pills.map((p) => (
                  <span key={p} className="where-pill">
                    {p}
                  </span>
                ))}
              </div>
            )}
            {editing ? (
              <textarea
                className="list-hero__desc-input"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                aria-label="List description"
              />
            ) : (
              data.description && <p className="hero__overview">{data.description}</p>
            )}
          </div>
        </div>
      </section>

      {count === 0 && !editing ? (
        <div className="empty-state">
          <p className="empty-state__emoji">📋</p>
          <h2>No titles yet</h2>
          <p className="muted">Tap “Edit details”, then ＋ to add titles from Search.</p>
        </div>
      ) : (
        <ul className="poster-grid">
          {data.items.map((it) => {
            const src = itemImage(it)
            const isLogo = it.mediaType === 'sport'
            const watchNext = isWatchNextId(it.id)
            return (
              <li key={it.id} className="poster-cell">
                <Link
                  to={watchNext ? WATCH_NEXT_LINK : `/item/${encodeURIComponent(it.id)}`}
                  className="poster-card"
                  title={watchNext ? 'Watch Next — shuffle a suggestion' : it.title}
                >
                  {watchNext ? (
                    <WatchNextPoster className="poster-card__img" />
                  ) : src ? (
                    <img
                      className={`poster-card__img${isLogo ? ' poster-card__img--logo' : ''}`}
                      src={src}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className="poster-card__img poster-card__img--placeholder">
                      {itemEmoji(it)}
                    </div>
                  )}
                  <span className="poster-card__title">{watchNext ? 'Watch Next' : it.title}</span>
                </Link>
                {editing && (
                  <button
                    type="button"
                    className="list-remove"
                    title="Remove from list"
                    aria-label={`Remove ${it.title}`}
                    onClick={() => void removeFromList(data.id, it.id)}
                  >
                    −
                  </button>
                )}
              </li>
            )
          })}
          {editing && (
            <li className="poster-cell">
              <button
                type="button"
                className="poster-add"
                onClick={() => navigate(`/search?addToList=${encodeURIComponent(data.id)}`)}
                title="Add titles from Search"
              >
                <span className="poster-add__plus" aria-hidden="true">
                  +
                </span>
                <span className="poster-add__label">Add titles</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
