import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  getComments,
  getReplies,
  hasTraktClientId,
  likeComment,
  postComment,
  postReply,
  unlikeComment,
  type CommentSort,
  type CommentsPage,
  type ReviewTarget,
  type TraktComment,
} from '../api/trakt'
import { useTraktAuth } from '../hooks/useTraktAuth'
import { UserGlyph } from '../views/Stats'

/** Collapsible reviews/discussion section (Trakt) for the bottom of detail pages. */
export default function Reviews({ target, poweredBy }: { target: ReviewTarget; poweredBy?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <details
      className="reviews"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="reviews__summary">
        <span>Community discussion &amp; reviews</span>
        {poweredBy && hasTraktClientId() && <span className="reviews__powered">Powered by Trakt</span>}
      </summary>
      <div className="reviews__body">
        {!hasTraktClientId() ? (
          <p className="muted">Reviews aren’t configured yet.</p>
        ) : open ? (
          <ReviewsBody target={target} />
        ) : null}
      </div>
    </details>
  )
}

function queryKeyFor(target: ReviewTarget, sort: CommentSort, page: number) {
  return ['trakt-comments', target.mediaType, target.tmdbId, target.season, target.episode, sort, page]
}

function ReviewsBody({ target }: { target: ReviewTarget }) {
  const { signedIn } = useTraktAuth()
  const [sort, setSort] = useState<CommentSort>('likes')
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error, isPlaceholderData } = useQuery({
    queryKey: queryKeyFor(target, sort, page),
    queryFn: () => getComments(target, sort, page),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  function changeSort(s: CommentSort) {
    setSort(s)
    setPage(1)
  }

  // Show the just-posted review immediately by inserting it at the top of the
  // current list (Trakt's own list is briefly cached, so an immediate refetch
  // would miss it). No polling needed — the POST hands us the new comment.
  function handlePosted(created?: TraktComment) {
    if (!created) {
      void queryClient.invalidateQueries({ queryKey: ['trakt-comments'] })
      return
    }
    queryClient.setQueryData<CommentsPage>(queryKeyFor(target, sort, page), (old) =>
      old ? { ...old, comments: [created, ...old.comments] } : old,
    )
  }

  const comments = data?.comments ?? []
  const pageCount = data?.pageCount ?? 1

  return (
    <div className="reviews-panel">
      <div className="reviews-panel__head">
        <div className="review-sort" role="tablist" aria-label="Sort reviews">
          <button
            className={`review-sort__btn${sort === 'likes' ? ' review-sort__btn--on' : ''}`}
            onClick={() => changeSort('likes')}
            aria-pressed={sort === 'likes'}
            title="Most popular"
          >
            <FlameIcon />
            <span>Popular</span>
          </button>
          <button
            className={`review-sort__btn${sort === 'newest' ? ' review-sort__btn--on' : ''}`}
            onClick={() => changeSort('newest')}
            aria-pressed={sort === 'newest'}
            title="Most recent"
          >
            <ClockIcon />
            <span>Recent</span>
          </button>
        </div>
        {!signedIn && (
          <Link to="/settings" className="btn btn--small btn--ghost">
            Sign in to post
          </Link>
        )}
      </div>

      {signedIn && <Composer target={target} onPosted={handlePosted} />}

      {isLoading && <p className="muted">Loading reviews…</p>}
      {isError && (
        <p className="badge badge--warn">
          {error instanceof Error ? error.message : 'Could not load reviews.'}
        </p>
      )}
      {!isLoading && !isError && comments.length === 0 && (
        <p className="muted">No reviews yet{signedIn ? ' — be the first!' : '.'}</p>
      )}

      <ul className={`comment-list${isPlaceholderData ? ' comment-list--loading' : ''}`}>
        {comments.map((c) => (
          <CommentCard key={c.id} comment={c} canInteract={signedIn} />
        ))}
      </ul>

      {pageCount > 1 && (
        <div className="reviews-pager">
          <button
            className="btn btn--small btn--ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Prev
          </button>
          <span className="muted">
            Page {page} of {pageCount}
          </span>
          <button
            className="btn btn--small btn--ghost"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  )
}

function Composer({
  target,
  onPosted,
  replyTo,
  onDone,
}: {
  target?: ReviewTarget
  onPosted?: (created?: TraktComment) => void
  replyTo?: number
  onDone?: () => void
}) {
  const [text, setText] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      let created: TraktComment | undefined
      if (replyTo != null) created = await postReply(replyTo, text, spoiler)
      else if (target) created = await postComment(target, text, spoiler)
      setText('')
      setSpoiler(false)
      onPosted?.(created)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        placeholder={replyTo != null ? 'Write a reply…' : 'Write a review…'}
        value={text}
        rows={replyTo != null ? 2 : 3}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="composer__row">
        <label className="composer__spoiler">
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
          Contains spoilers
        </label>
        <div className="composer__actions">
          {onDone && (
            <button className="btn btn--small btn--ghost" disabled={busy} onClick={onDone}>
              Cancel
            </button>
          )}
          <button
            className="btn btn--small"
            disabled={busy || text.trim().split(/\s+/).length < 5}
            onClick={() => void submit()}
          >
            {busy ? 'Posting…' : replyTo != null ? 'Reply' : 'Post review'}
          </button>
        </div>
      </div>
      <p className="composer__hint muted">Trakt requires at least 5 words.</p>
      {error && <p className="badge badge--warn">{error}</p>}
    </div>
  )
}

function FlameIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function CommentCard({ comment, canInteract }: { comment: TraktComment; canInteract: boolean }) {
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(comment.likes)
  const [likeBusy, setLikeBusy] = useState(false)
  const [showSpoiler, setShowSpoiler] = useState(false)
  const [replies, setReplies] = useState<TraktComment[] | null>(null)
  const [repliesFetched, setRepliesFetched] = useState(false)
  const [replyCount, setReplyCount] = useState(comment.replies)
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [replying, setReplying] = useState(false)
  const [avatarOk, setAvatarOk] = useState(true)

  // Show a just-posted reply right away (append to whatever's loaded, open the
  // thread, and bump the count) instead of waiting for a refresh.
  function handleReplyPosted(created?: TraktComment) {
    if (!created) return
    setReplies((prev) => [...(prev ?? []), created])
    setReplyCount((n) => n + 1)
    setRepliesOpen(true)
  }

  const avatar = comment.user.images?.avatar?.full
  const showAvatar = !!avatar && avatarOk

  async function toggleLike() {
    setLikeBusy(true)
    try {
      if (liked) {
        await unlikeComment(comment.id)
        setLiked(false)
        setLikes((n) => Math.max(0, n - 1))
      } else {
        await likeComment(comment.id)
        setLiked(true)
        setLikes((n) => n + 1)
      }
    } catch {
      // leave state as-is on failure
    } finally {
      setLikeBusy(false)
    }
  }

  async function loadReplies() {
    const willOpen = !repliesOpen
    setRepliesOpen(willOpen)
    if (willOpen && !repliesFetched) {
      setRepliesFetched(true)
      try {
        const fetched = await getReplies(comment.id)
        // Merge with any optimistically-added reply, de-duped by id, oldest first.
        setReplies((prev) => {
          const byId = new Map<number, TraktComment>()
          for (const r of fetched) byId.set(r.id, r)
          for (const r of prev ?? []) if (!byId.has(r.id)) byId.set(r.id, r)
          return [...byId.values()].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          )
        })
      } catch {
        // keep whatever we have (e.g. the optimistic reply)
      }
    }
  }

  return (
    <li className="comment">
      <div className="comment__head">
        {showAvatar ? (
          <img
            className="comment__avatar"
            src={avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setAvatarOk(false)}
          />
        ) : (
          <span className="comment__avatar comment__avatar--ph" aria-hidden="true">
            <UserGlyph />
          </span>
        )}
        <div className="comment__who">
          <span className="comment__user">{comment.user.username}</span>
          <span className="comment__date muted">
            {new Date(comment.created_at).toLocaleDateString()}
          </span>
        </div>
        <div className="comment__tags">
          {comment.user_rating != null && comment.user_rating > 0 && (
            <span className="comment__rating">★ {comment.user_rating}</span>
          )}
          {comment.review && <span className="pill">Review</span>}
          {comment.spoiler && <span className="pill pill--warn">Spoiler</span>}
        </div>
      </div>

      {comment.spoiler && !showSpoiler ? (
        <button className="comment__spoiler-btn" onClick={() => setShowSpoiler(true)}>
          Show spoiler
        </button>
      ) : (
        <p className="comment__text">{comment.comment}</p>
      )}

      <div className="comment__foot">
        <button
          className={`comment__like${liked ? ' comment__like--on' : ''}`}
          disabled={!canInteract || likeBusy}
          title={canInteract ? 'Like' : 'Sign in to like'}
          onClick={() => void toggleLike()}
        >
          👍 {likes}
        </button>
        {replyCount > 0 && (
          <button className="comment__link" onClick={() => void loadReplies()}>
            {repliesOpen ? 'Hide' : 'View'} {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
        {canInteract && (
          <button className="comment__link" onClick={() => setReplying((r) => !r)}>
            Reply
          </button>
        )}
      </div>

      {replying && (
        <Composer
          replyTo={comment.id}
          onDone={() => setReplying(false)}
          onPosted={handleReplyPosted}
        />
      )}

      {repliesOpen && replies && replies.length > 0 && (
        <ul className="comment-list comment-list--replies">
          {replies.map((r) => (
            <CommentCard key={r.id} comment={r} canInteract={canInteract} />
          ))}
        </ul>
      )}
    </li>
  )
}
