import { imageUrl, type TmdbImage, type TmdbVideo } from '../api/tmdb'

// Show the most interesting videos first.
const TYPE_ORDER = [
  'Trailer',
  'Teaser',
  'Clip',
  'Featurette',
  'Behind the Scenes',
  'Bloopers',
  'Deleted Scene',
]

function rankVideo(v: TmdbVideo): number {
  const i = TYPE_ORDER.indexOf(v.type)
  return (i === -1 ? TYPE_ORDER.length : i) * 2 + (v.official ? 0 : 1)
}

/** A grid of videos (trailers/clips, linking to YouTube) and screencap stills. */
export default function Gallery({
  videos = [],
  images = [],
}: {
  videos?: TmdbVideo[]
  images?: TmdbImage[]
}) {
  const vids = [...videos].sort((a, b) => rankVideo(a) - rankVideo(b)).slice(0, 8)
  const imgs = images.slice(0, 10)
  if (vids.length === 0 && imgs.length === 0) return null
  return (
    <div className="gallery">
      {vids.map((v) => (
        <a
          key={v.key}
          href={`https://www.youtube.com/watch?v=${v.key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="gallery__item gallery__item--video"
          title={`${v.type}: ${v.name}`}
        >
          <img src={`https://img.youtube.com/vi/${v.key}/mqdefault.jpg`} alt="" loading="lazy" />
          <span className="gallery__play" aria-hidden="true">
            ▶
          </span>
          <span className="gallery__vtype">{v.type}</span>
        </a>
      ))}
      {imgs.map((img) => (
        <a
          key={img.file_path}
          href={imageUrl(img.file_path, 'original')}
          target="_blank"
          rel="noopener noreferrer"
          className="gallery__item"
        >
          <img src={imageUrl(img.file_path, 'w300')} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  )
}
