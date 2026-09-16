import { alignSubtitles, type AlignmentOptions, type AlignmentRow } from './alignment';
import { editDistance, normalize } from './lyricSimilarity';
import type { SubtitleEntry } from './subtitles';

/** A lyric reference belonging to one item in the user supplied playlist. */
export type PlaylistTrackReference = {
  id: string | number;
  name: string;
  artists: string;
  lines: string[];
};

/** A normal alignment row annotated with the source playlist item. */
export type PlaylistAlignmentRow = AlignmentRow & {
  trackIndex?: number;
};

type ActiveTrack = {
  index: number;
  lines: string[];
};

const DEFAULT_OPTIONS: AlignmentOptions = {
  algorithm: 'fragment',
  smartSegmentation: false,
};

/*
 * Keep the segmentation scorer deliberately independent from the renderer's
 * row shape. A local subtitle can be a merged fragment, so compare it with
 * short consecutive lyric groups as well as individual reference lines.
 */
function referenceCost(localText: string, lines: string[]): number {
  const local = normalize(localText);
  if (!local || lines.length === 0) return 1;
  let best = Number.POSITIVE_INFINITY;
  const maxGroup = Math.min(3, lines.length);
  for (let start = 0; start < lines.length; start += 1) {
    let combined = '';
    for (let count = 1; count <= maxGroup && start + count <= lines.length; count += 1) {
      combined += normalize(lines[start + count - 1]);
      if (!combined) continue;
      const distance = editDistance(local, combined) / Math.max(local.length, combined.length, 1);
      best = Math.min(best, distance);
    }
  }
  return Math.min(best, 1);
}

function lineAssignmentValue(cost: number): number {
  // Strong matches should attract a line to their track. Unknown stage
  // directions are kept almost neutral so they do not block later songs.
  if (cost <= 0.65) return cost - 0.8;
  return 0.12;
}

function buildPrefixValues(local: SubtitleEntry[], track: ActiveTrack): number[] {
  const prefix = [0];
  for (const entry of local) {
    prefix.push(prefix[prefix.length - 1] + lineAssignmentValue(referenceCost(entry.text, track.lines)));
  }
  return prefix;
}

function chooseBoundaries(local: SubtitleEntry[], tracks: ActiveTrack[]): number[] {
  const trackCount = tracks.length;
  const localCount = local.length;
  if (trackCount === 0) return [0, localCount];

  const prefixes = tracks.map((track) => buildPrefixValues(local, track));
  const totalReferenceLines = tracks.reduce((sum, track) => sum + track.lines.length, 0);
  const costs = Array.from({ length: trackCount + 1 }, () => Array<number>(localCount + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: trackCount + 1 }, () => Array<number>(localCount + 1).fill(-1));
  costs[0][0] = 0;

  for (let trackIndex = 1; trackIndex <= trackCount; trackIndex += 1) {
    const track = tracks[trackIndex - 1];
    const prefix = prefixes[trackIndex - 1];
    const referenceLinesThroughTrack = tracks
      .slice(0, trackIndex)
      .reduce((sum, current) => sum + current.lines.length, 0);
    const targetEnd = totalReferenceLines > 0
      ? localCount * referenceLinesThroughTrack / totalReferenceLines
      : 0;
    for (let end = 0; end <= localCount; end += 1) {
      let best = Number.POSITIVE_INFINITY;
      let bestStart = -1;
      for (let start = 0; start <= end; start += 1) {
        const prior = costs[trackIndex - 1][start];
        if (!Number.isFinite(prior)) continue;
        const value = prefix[end] - prefix[start];
        // A very small length hint only resolves otherwise ambiguous repeated
        // lyrics; the textual evidence remains the dominant signal.
        const lengthHint = Math.abs(end - targetEnd) * 0.012;
        const candidate = prior + value + lengthHint;
        // Prefer the later split on exact ties. This keeps an unrecognised
        // spoken interlude with the preceding song instead of stealing it from
        // the next song's first matching line.
        if (candidate < best - 1e-9 || (Math.abs(candidate - best) <= 1e-9 && start > bestStart)) {
          best = candidate;
          bestStart = start;
        }
      }
      costs[trackIndex][end] = best;
      previous[trackIndex][end] = bestStart;
    }
  }

  // The final state must consume all recognition rows. Backtracking yields
  // one boundary per active track, including empty segments where a song was
  // not present in the imported transcript.
  const boundaries = Array<number>(trackCount + 1).fill(0);
  boundaries[trackCount] = localCount;
  let end = localCount;
  for (let trackIndex = trackCount; trackIndex > 0; trackIndex -= 1) {
    const start = previous[trackIndex][end];
    boundaries[trackIndex - 1] = start >= 0 ? start : 0;
    end = start >= 0 ? start : 0;
  }
  boundaries[0] = 0;
  return boundaries;
}

function annotateRows(rows: AlignmentRow[], trackIndex: number): PlaylistAlignmentRow[] {
  return rows.map((row) => ({
    ...row,
    // Reference-only rows use an index local to their track. Prefixing keeps
    // React keys and row-edit actions unique across the complete playlist.
    id: `track-${trackIndex}-${row.id}`,
    trackIndex,
  }));
}

/**
 * Align imported subtitles against a playlist in playlist order.
 *
 * Each track receives its own call to alignSubtitles, which means a group of
 * reference lines can never span two songs. Empty lyric responses are omitted
 * from segmentation so they do not consume recognition rows or block later
 * tracks. The returned rows retain the regular AlignmentRow contract and add
 * an optional original playlist index.
 */
export function alignPlaylist(
  local: SubtitleEntry[],
  tracks: PlaylistTrackReference[],
  options: AlignmentOptions = DEFAULT_OPTIONS,
): PlaylistAlignmentRow[] {
  if (tracks.length === 0) {
    return alignSubtitles(local, [], options).map((row) => ({ ...row }));
  }

  const activeTracks: ActiveTrack[] = tracks.flatMap((track, index) => {
    const lines = track.lines.map((line) => line.trim()).filter(Boolean);
    return lines.length ? [{ index, lines }] : [];
  });

  if (activeTracks.length === 0) {
    return alignSubtitles(local, [], options).map((row) => ({ ...row }));
  }

  const boundaries = chooseBoundaries(local, activeTracks);
  const rows: PlaylistAlignmentRow[] = [];
  activeTracks.forEach((track, index) => {
    const start = boundaries[index] ?? 0;
    const end = boundaries[index + 1] ?? start;
    const segment = local.slice(Math.max(0, start), Math.max(start, end));
    rows.push(...annotateRows(alignSubtitles(segment, track.lines, options), track.index));
  });
  return rows;
}
