import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent } from 'react';
import { alignSubtitles, type AlignmentRow } from './lib/alignment';
import type { MatchingAlgorithm } from './lib/matchingAlgorithms';
import { copyText, splitReferenceLines } from './lib/clipboard';
import { alignPlaylist, type PlaylistAlignmentRow, type PlaylistTrackReference } from './lib/playlistMatching';
import { getPlaylistThrottleOptions, runThrottled } from './lib/requestScheduler';
import { createExportEntries } from './lib/reviewExport';
import { exportSrt, exportTxt, parseSubtitle, type SubtitleEntry } from './lib/subtitles';
import { fetchNeteaseLyric, searchNetease, stripLyricTimestamps, type NeteaseSong } from './server/netease';

type ExportKind = 'srt' | 'txt';
type SourceView = 'srt' | 'txt';
type MatchMode = 'single' | 'playlist';

type PlaylistTrackState = {
  id: string;
  query: string;
  candidates: NeteaseSong[];
  selectedSong: NeteaseSong | null;
  referenceLines: string[];
  status: 'queued' | 'searching' | 'search-ready' | 'lyric-loading' | 'ready' | 'error';
  error?: string;
};

const starterSrt = `1\n00:00:01,000 --> 00:00:03,000\n把酒倒满\n\n2\n00:00:04,000 --> 00:00:06,000\n朋友一生一起走\n\n3\n00:00:07,000 --> 00:00:09,000\n那些日子不再有`;

function parsePlaylistQueries(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function formatAudioTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatSubtitleTimestamp(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const milliseconds = value % 1_000;
  const totalSeconds = Math.floor(value / 1_000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

type PlaylistMatchPanelProps = {
  initialValue: string;
  isMatchingPlaylist: boolean;
  isSearchingPlaylist?: boolean;
  playlistTracks: PlaylistTrackState[];
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onChooseSong: (trackIndex: number, songId: number) => void;
  onRetryTrack: (trackIndex: number, query: string) => void;
};

function playlistTrackStatus(track: PlaylistTrackState): string {
  if (track.status === 'queued') return '等待搜索…';
  if (track.status === 'searching') return '正在搜索…';
  if (track.status === 'search-ready') return `已找到 ${track.candidates.length} 个候选，等待其它歌曲搜索`;
  if (track.status === 'lyric-loading') return '正在获取歌词…';
  if (track.status === 'ready') return `${track.selectedSong?.name ?? track.query} · ${track.selectedSong?.artists ?? ''}`;
  return track.error ?? '搜索失败';
}

export function PlaylistMatchPanel({ initialValue, isMatchingPlaylist, isSearchingPlaylist = false, playlistTracks, onDraftChange, onSubmit, onChooseSong, onRetryTrack }: PlaylistMatchPanelProps) {
  const [playlistDraft, setPlaylistDraft] = useState(initialValue);
  const [editingTrackIndex, setEditingTrackIndex] = useState<number | null>(null);
  const [editingQuery, setEditingQuery] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(playlistDraft);
  }

  function handleDraftChange(value: string) {
    setPlaylistDraft(value);
    onDraftChange(value);
  }

  function beginEditing(trackIndex: number) {
    setEditingTrackIndex(trackIndex);
    setEditingQuery(playlistTracks[trackIndex]?.query ?? '');
  }

  function saveAndRetry(trackIndex: number) {
    const nextQuery = editingQuery.trim();
    if (!nextQuery) return;
    const nextDraft = playlistTracks.map((track, index) => index === trackIndex ? nextQuery : track.query).join('\n');
    setPlaylistDraft(nextDraft);
    onDraftChange(nextDraft);
    setEditingTrackIndex(null);
    onRetryTrack(trackIndex, nextQuery);
  }

  return <>
    <form className="playlist-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="playlist">演唱会歌单（每行一首，按演出顺序）</label>
      <textarea id="playlist" className="playlist-input" value={playlistDraft} onChange={(event) => handleDraftChange(event.target.value)} placeholder="例如：歌名 - 歌手\n下一首歌 - 歌手" />
      <div className="search-row playlist-submit"><button type="submit" disabled={isMatchingPlaylist}>{isMatchingPlaylist ? '匹配中…' : '按歌单匹配'}</button></div>
    </form>
    <div className="playlist-track-list">
      {playlistTracks.length === 0 && <p className="empty-note">输入歌单后，工具会按顺序搜索每首歌并自动分段。</p>}
      {playlistTracks.map((track, trackIndex) => {
        const isBusy = track.status === 'queued' || track.status === 'searching' || track.status === 'lyric-loading';
        const controlsDisabled = isBusy || (isMatchingPlaylist && !isSearchingPlaylist);
        return <div className="playlist-track" key={track.id}>
        <div className="playlist-track-heading"><span className="playlist-track-number">{String(trackIndex + 1).padStart(2, '0')}</span><div>{editingTrackIndex === trackIndex ? <div className="playlist-track-editor"><input aria-label={`编辑第 ${trackIndex + 1} 首歌曲名`} value={editingQuery} onChange={(event) => setEditingQuery(event.target.value)} /><button type="button" aria-label={`保存并重新搜索第 ${trackIndex + 1} 首歌曲`} disabled={!editingQuery.trim()} onClick={() => saveAndRetry(trackIndex)}>保存并重搜</button><button type="button" onClick={() => setEditingTrackIndex(null)}>取消</button></div> : <><strong>{track.query}</strong><small>{playlistTrackStatus(track)}</small></>}</div></div>
        <div className="playlist-track-controls">
          {track.candidates.length > 0 && <select aria-label={`选择第 ${trackIndex + 1} 首歌曲`} value={track.selectedSong?.id ?? ''} disabled={controlsDisabled} onChange={(event) => onChooseSong(trackIndex, Number(event.target.value))}>{track.candidates.map((song) => <option key={song.id} value={song.id}>{song.name} · {song.artists}</option>)}</select>}
          {editingTrackIndex !== trackIndex && <div className="playlist-track-actions"><button type="button" aria-label={`编辑第 ${trackIndex + 1} 首歌曲`} disabled={controlsDisabled} onClick={() => beginEditing(trackIndex)}>编辑</button><button type="button" aria-label={`重新搜索第 ${trackIndex + 1} 首歌曲`} disabled={controlsDisabled} onClick={() => onRetryTrack(trackIndex, track.query)}>重试</button></div>}
        </div>
      </div>;
      })}
    </div>
  </>;
}

type ReviewRowProps = {
  row: PlaylistAlignmentRow;
  index: number;
  showTrackHeading: boolean;
  track?: PlaylistTrackState;
  copiedLineIndex: number | null;
  timestampMs?: number;
  playbackTimeMs?: number;
  onChooseRow: (row: AlignmentRow, choice: 'local' | 'reference') => void;
  onUpdateRow: (id: string, patch: Partial<AlignmentRow>) => void;
  onToggleExport: (id: string, checked: boolean, shiftKey: boolean) => void;
  onCopyReference: (row: AlignmentRow, lineText: string, lineIndex: number) => void;
  onPasteRow: () => Promise<string | null>;
  onPlayRow: (row: AlignmentRow) => void;
  isPlaybackActive: boolean;
  isAudioCurrent: boolean;
};

const ReviewRow = memo(function ReviewRow({ row, index, showTrackHeading, track, copiedLineIndex, timestampMs, playbackTimeMs, onChooseRow, onUpdateRow, onToggleExport, onCopyReference, onPasteRow, onPlayRow, isPlaybackActive, isAudioCurrent }: ReviewRowProps) {
  const [chosenTextDraft, setChosenTextDraft] = useState({ row, value: row.chosenText });
  const [exportDraft, setExportDraft] = useState({ row, value: row.includeInExport });
  const [reviewDraft, setReviewDraft] = useState({ row, value: row.needsReview });
  const currentRowRef = useRef<PlaylistAlignmentRow | null>(row);
  const draftVersionRef = useRef(0);
  currentRowRef.current = row;
  const chosenText = chosenTextDraft.row === row ? chosenTextDraft.value : row.chosenText;
  const includeInExport = exportDraft.row === row ? exportDraft.value : row.includeInExport;
  const needsReview = reviewDraft.row === row ? reviewDraft.value : row.needsReview;

  useEffect(() => {
    currentRowRef.current = row;
    return () => { currentRowRef.current = null; };
  }, []);

  function handleChoose(choice: 'local' | 'reference') {
    draftVersionRef.current += 1;
    setChosenTextDraft({ row, value: choice === 'reference' ? row.referenceText : row.localText });
    onChooseRow(row, choice);
  }

  async function handlePaste() {
    const version = ++draftVersionRef.current;
    const text = await onPasteRow();
    if (text !== null && currentRowRef.current === row && draftVersionRef.current === version) {
      setChosenTextDraft({ row, value: text });
      onUpdateRow(row.id, { chosenText: text });
    }
  }

  return <Fragment>
    {showTrackHeading && <div className="playlist-section-heading" data-track-index={row.trackIndex}><span>{String((row.trackIndex ?? 0) + 1).padStart(2, '0')}</span><strong>{track?.selectedSong?.name ?? track?.query ?? '歌单歌曲'}</strong><small>{track?.selectedSong?.artists}</small></div>}
    <div className={`diff-row ${row.kind} ${isAudioCurrent ? 'audio-current' : ''}`} data-row-id={row.id}>
      <div className="line-number" title={timestampMs === undefined ? undefined : formatSubtitleTimestamp(timestampMs)}>{String(index + 1).padStart(2, '0')}</div>
      <div className="diff-cell local"><span>{row.localText || '—'}</span></div>
      <div className="diff-cell reference">{row.referenceText ? <div className="reference-lines">{splitReferenceLines(row.referenceText).map((lineText, lineIndex) => { const lineKey = `${row.id}-${lineIndex}`; return <div className="reference-line" key={lineKey}><span>{lineText}</span><button type="button" className="copy-reference" onClick={() => onCopyReference(row, lineText, lineIndex)} aria-label={`复制第 ${index + 1} 行网易云歌词的第 ${lineIndex + 1} 句`}>{copiedLineIndex === lineIndex ? '已复制' : '复制'}</button></div>; })}</div> : <span>—</span>}</div>
      <div className="row-controls">
        <button type="button" className={`row-playback ${isPlaybackActive ? 'playing' : ''}`} onClick={() => onPlayRow(row)} disabled={playbackTimeMs === undefined} aria-pressed={isPlaybackActive} aria-label={playbackTimeMs === undefined ? `第 ${index + 1} 行没有可播放时间轴` : `${isPlaybackActive ? '播放中' : '播放'}第 ${index + 1} 行`} title={playbackTimeMs === undefined ? '该行没有本地字幕时间轴' : `从 ${formatAudioTime(playbackTimeMs / 1000)} 播放`}>{isPlaybackActive ? '播放中' : '播放'}</button>
        <button type="button" onClick={() => handleChoose('local')} className={chosenText === row.localText ? 'active' : ''} disabled={row.kind === 'add'}>现场</button>
        <button type="button" onClick={() => handleChoose('reference')} className={chosenText === row.referenceText && Boolean(row.referenceText) ? 'active reference-choice' : ''} disabled={!row.referenceText || row.localIds.length > 1} title={row.localIds.length > 1 ? '多个 SRT 条目合并显示，参考文本仅用于对比' : undefined}>参考</button>
        <input aria-label={`编辑第 ${index + 1} 行`} value={chosenText} disabled={row.localIds.length > 1} onChange={(event) => { draftVersionRef.current += 1; setChosenTextDraft({ row, value: event.target.value }); onUpdateRow(row.id, { chosenText: event.target.value }); }} />
        <button type="button" className="clear-paste-row" aria-label={`清空并粘贴第 ${index + 1} 行`} title="清空当前输入并粘贴剪切板文本" onClick={() => { void handlePaste(); }} disabled={row.localIds.length > 1}>清空并粘贴</button>
        <label className="export-toggle"><input type="checkbox" aria-label={`导出第 ${index + 1} 行`} checked={includeInExport} onChange={(event) => { setExportDraft({ row, value: event.target.checked }); onToggleExport(row.id, event.target.checked, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey); }} />导出</label>
        <label className="review-toggle"><input type="checkbox" aria-label={`复核第 ${index + 1} 行`} checked={needsReview} onChange={(event) => { setReviewDraft({ row, value: event.target.checked }); onUpdateRow(row.id, { needsReview: event.target.checked }); }} />复核</label>
      </div>
    </div>
  </Fragment>;
});

type CopiedLine = { rowId: string; lineIndex: number };

type ReviewTableProps = {
  isLoadingLyric: boolean;
  isMatchingPlaylist: boolean;
  isSearchingPlaylist: boolean;
  matchMode: MatchMode;
  rows: PlaylistAlignmentRow[];
  playlistTracks: PlaylistTrackState[];
  entriesById: ReadonlyMap<string, SubtitleEntry>;
  hasAudio: boolean;
  copiedLine: CopiedLine | null;
  activePlaybackRowId: string | null;
  currentAudioRowId: string | null;
  onChooseRow: (row: AlignmentRow, choice: 'local' | 'reference') => void;
  onUpdateRow: (id: string, patch: Partial<AlignmentRow>) => void;
  onToggleExport: (id: string, checked: boolean, shiftKey: boolean) => void;
  onCopyReference: (row: AlignmentRow, lineText: string, lineIndex: number) => void;
  onPasteRow: () => Promise<string | null>;
  onPlayRow: (row: AlignmentRow) => void;
};

type ReviewOutlineProps = {
  rows: PlaylistAlignmentRow[];
  playlistTracks: PlaylistTrackState[];
  currentAudioRowId: string | null;
};

const ReviewOutline = memo(function ReviewOutline({ rows, playlistTracks, currentAudioRowId }: ReviewOutlineProps) {
  const [isExpanded, setIsExpanded] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1840);
  const currentTrackIndex = currentAudioRowId === null
    ? undefined
    : rows.find((row) => row.id === currentAudioRowId)?.trackIndex;
  const rowCounts = useMemo(() => rows.reduce((counts, row) => {
    if (row.trackIndex !== undefined) counts[row.trackIndex] = (counts[row.trackIndex] ?? 0) + 1;
    return counts;
  }, {} as Record<number, number>), [rows]);

  function jumpToTrack(trackIndex: number) {
    const target = document.querySelector<HTMLElement>(`[data-track-index="${trackIndex}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return <aside className={`review-outline ${isExpanded ? 'expanded' : 'collapsed'}`} aria-label="歌曲目录">
    <div className="review-outline-heading"><span className="section-kicker">歌单目录</span><small>{playlistTracks.length} 首歌曲</small><button type="button" className="review-outline-toggle" aria-expanded={isExpanded} aria-controls="review-outline-list" onClick={() => setIsExpanded((expanded) => !expanded)}>{isExpanded ? '收起' : '目录'}</button></div>
    <nav id="review-outline-list">
      {playlistTracks.map((track, trackIndex) => {
        const isCurrent = currentTrackIndex === trackIndex;
        const songName = track.selectedSong?.name ?? track.query ?? `第 ${trackIndex + 1} 首歌曲`;
        return <button type="button" key={track.id} className={`review-outline-song ${isCurrent ? 'current' : ''}`} aria-current={isCurrent ? 'true' : undefined} aria-label={`跳转到第 ${trackIndex + 1} 首歌曲 ${songName}`} onClick={() => jumpToTrack(trackIndex)}>
          <span className="review-outline-index">{String(trackIndex + 1).padStart(2, '0')}</span>
          <span className="review-outline-copy"><strong>{songName}</strong><small>{isCurrent ? '播放中' : `${rowCounts[trackIndex] ?? 0} 行`}</small></span>
        </button>;
      })}
    </nav>
  </aside>;
});

const ReviewTable = memo(function ReviewTable({ isLoadingLyric, isMatchingPlaylist, isSearchingPlaylist, matchMode, rows, playlistTracks, entriesById, hasAudio, copiedLine, activePlaybackRowId, currentAudioRowId, onChooseRow, onUpdateRow, onToggleExport, onCopyReference, onPasteRow, onPlayRow }: ReviewTableProps) {
  return <div className="diff-table">
    {(isLoadingLyric || isMatchingPlaylist) && <div className="loading-state">{isSearchingPlaylist ? '正在逐首搜索歌单…' : '正在抓取歌词并按歌单顺序对齐…'}</div>}
    {!isLoadingLyric && !isMatchingPlaylist && rows.length === 0 && <div className="empty-review"><span className="empty-symbol">↔</span><strong>等待参考歌词</strong><p>{matchMode === 'playlist' ? '输入歌单后，工具会按顺序分段并保留现场独有内容。' : '先搜索并选择一首歌曲，工具会保留现场顺序，标出每处不同。'}</p></div>}
    {!isLoadingLyric && !isMatchingPlaylist && rows.map((row, index) => {
      const previousTrackIndex = index > 0 ? rows[index - 1].trackIndex : undefined;
      const showTrackHeading = matchMode === 'playlist' && row.trackIndex !== undefined && row.trackIndex !== previousTrackIndex;
      const track = row.trackIndex === undefined ? undefined : playlistTracks[row.trackIndex];
      const playbackTimeMs = entriesById.get(row.localIds[0])?.startMs;
      return <ReviewRow key={row.id} row={row} index={index} showTrackHeading={showTrackHeading} track={track} copiedLineIndex={copiedLine?.rowId === row.id ? copiedLine.lineIndex : null} timestampMs={playbackTimeMs} playbackTimeMs={hasAudio ? playbackTimeMs : undefined} onChooseRow={onChooseRow} onUpdateRow={onUpdateRow} onToggleExport={onToggleExport} onCopyReference={onCopyReference} onPasteRow={onPasteRow} onPlayRow={onPlayRow} isPlaybackActive={activePlaybackRowId === row.id} isAudioCurrent={currentAudioRowId === row.id} />;
    })}
  </div>;
});

function App() {
  const [sourceView, setSourceView] = useState<SourceView>('srt');
  const [sourceText, setSourceText] = useState(starterSrt);
  const [draftSourceText, setDraftSourceText] = useState(starterSrt);
  const [fileName, setFileName] = useState('未命名现场歌词.srt');
  const [entries, setEntries] = useState<SubtitleEntry[]>(() => parseSubtitle(starterSrt, 'srt'));
  const playlistDraftRef = useRef('');
  const [query, setQuery] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('single');
  const [songs, setSongs] = useState<NeteaseSong[]>([]);
  const [selectedSong, setSelectedSong] = useState<NeteaseSong | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrackState[]>([]);
  const [rows, setRows] = useState<PlaylistAlignmentRow[]>(() => alignSubtitles(parseSubtitle(starterSrt, 'srt'), [], { algorithm: 'fragment', smartSegmentation: true }));
  const [referenceLines, setReferenceLines] = useState<string[]>([]);
  const [matchingAlgorithm, setMatchingAlgorithm] = useState<MatchingAlgorithm>('fragment');
  const [smartSegmentation, setSmartSegmentation] = useState(true);
  const matchingSettings = useRef({ algorithm: 'fragment' as MatchingAlgorithm, smartSegmentation: true });
  const lyricRequestId = useRef(0);
  const playlistTracksRef = useRef<PlaylistTrackState[]>([]);
  const playlistOperationVersionsRef = useRef(new Map<string, number>());
  const playlistRetryPromisesRef = useRef(new Map<string, Promise<PlaylistTrackState | null>>());
  const playlistSearchPhaseRef = useRef(false);
  const playlistInitialSearchPromiseRef = useRef<Promise<unknown> | null>(null);
  const playlistManualRequestQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sourceLoadRequestId = useRef(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingLyric, setIsLoadingLyric] = useState(false);
  const [isMatchingPlaylist, setIsMatchingPlaylist] = useState(false);
  const [isSearchingPlaylist, setIsSearchingPlaylist] = useState(false);
  const [error, setError] = useState('');
  const [exportKind, setExportKind] = useState<ExportKind>('srt');
  const [isDragging, setIsDragging] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rowPlaybackEndRef = useRef<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState('');
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [activePlaybackRowId, setActivePlaybackRowId] = useState<string | null>(null);
  const [lyricFollowEnabled, setLyricFollowEnabled] = useState(false);
  const [currentAudioRowId, setCurrentAudioRowId] = useState<string | null>(null);
  const [copiedLine, setCopiedLine] = useState<CopiedLine | null>(null);
  const rowsRef = useRef(rows);
  const exportAnchorIdRef = useRef<string | null>(null);
  playlistTracksRef.current = playlistTracks;

  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry] as const)), [entries]);
  const rowIndexById = useMemo(() => new Map(rows.map((row, index) => [row.id, index] as const)), [rows]);
  const rowIndexByIdRef = useRef(rowIndexById);
  rowIndexByIdRef.current = rowIndexById;
  const hasTimeline = useMemo(() => entries.some((entry) => entry.startMs !== undefined), [entries]);
  const diffStats = useMemo(() => rows.reduce((stats, row) => {
    stats[row.kind] += 1;
    return stats;
  }, { equal: 0, change: 0, add: 0, remove: 0 } as Record<AlignmentRow['kind'], number>), [rows]);
  function buildExportText() {
    const output = createExportEntries(entries, rowsRef.current, exportKind);
    return exportKind === 'srt' ? exportSrt(output) : exportTxt(output);
  }
  const previewText = previewOpen ? buildExportText() : '';
  const parsedTxt = useMemo(() => exportTxt(entries), [entries]);
  const hasDraftChanges = draftSourceText !== sourceText;

  function replaceReviewRows(nextRows: PlaylistAlignmentRow[]) {
    rowsRef.current = nextRows;
    setRows(nextRows);
  }

  function replacePlaylistTracks(tracks: PlaylistTrackState[]) {
    playlistTracksRef.current = tracks;
    setPlaylistTracks(tracks);
  }

  function updatePlaylistTrack(trackId: string, update: (track: PlaylistTrackState) => PlaylistTrackState): PlaylistTrackState | null {
    let updatedTrack: PlaylistTrackState | null = null;
    const nextTracks = playlistTracksRef.current.map((track) => {
      if (track.id !== trackId) return track;
      updatedTrack = update(track);
      return updatedTrack;
    });
    if (updatedTrack) replacePlaylistTracks(nextTracks);
    return updatedTrack;
  }

  function nextPlaylistOperationVersion(trackId: string): number {
    const version = (playlistOperationVersionsRef.current.get(trackId) ?? 0) + 1;
    playlistOperationVersionsRef.current.set(trackId, version);
    return version;
  }

  function isCurrentPlaylistOperation(trackId: string, version: number, requestId: number): boolean {
    return requestId === lyricRequestId.current && playlistOperationVersionsRef.current.get(trackId) === version;
  }

  function enqueuePlaylistManualRequest<T>(operation: () => Promise<T>): Promise<T> {
    const result = playlistManualRequestQueueRef.current.then(operation, operation);
    playlistManualRequestQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!audioUrl) return;
    function handleAudioKeydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type !== 'checkbox') || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) target.blur();
        toggleAudioPlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) target.blur();
        stepAudio(-5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) target.blur();
        stepAudio(5);
      }
    }
    document.addEventListener('keydown', handleAudioKeydown);
    return () => document.removeEventListener('keydown', handleAudioKeydown);
  }, [audioUrl]);

  useEffect(() => {
    if (!previewOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previewCloseRef.current?.focus();
    function handlePreviewKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewOpen(false);
      if (event.key === 'Tab') {
        event.preventDefault();
        previewCloseRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handlePreviewKeydown);
    return () => {
      document.removeEventListener('keydown', handlePreviewKeydown);
      previousFocus?.focus();
    };
  }, [previewOpen]);

  function resetReviewState() {
    lyricRequestId.current += 1;
    playlistSearchPhaseRef.current = false;
    playlistInitialSearchPromiseRef.current = null;
    playlistRetryPromisesRef.current.clear();
    setIsLoadingLyric(false);
    setIsMatchingPlaylist(false);
    setIsSearchingPlaylist(false);
    setIsSearching(false);
    exportAnchorIdRef.current = null;
  }

  function changeMatchMode(nextMode: MatchMode) {
    if (nextMode === matchMode) return;
    lyricRequestId.current += 1;
    playlistSearchPhaseRef.current = false;
    playlistInitialSearchPromiseRef.current = null;
    playlistRetryPromisesRef.current.clear();
    setMatchMode(nextMode);
    setSongs([]);
    setSelectedSong(null);
    replaceReviewRows(alignSubtitles(entries, [], matchingSettings.current));
    setReferenceLines([]);
    exportAnchorIdRef.current = null;
    setIsLoadingLyric(false);
    setIsMatchingPlaylist(false);
    setIsSearchingPlaylist(false);
    setIsSearching(false);
    setError('');
  }

  function playlistReferences(tracks: PlaylistTrackState[]): PlaylistTrackReference[] {
    return tracks.map((track) => ({
      id: track.id,
      name: track.selectedSong?.name ?? track.query,
      artists: track.selectedSong?.artists ?? '',
      lines: track.referenceLines,
    }));
  }

  function applyPlaylistAlignment(tracks: PlaylistTrackState[], local = entries) {
    exportAnchorIdRef.current = null;
    const references = playlistReferences(tracks);
    const lines = references.flatMap((track) => track.lines);
    setReferenceLines(lines);
    if (lines.length === 0) {
      replaceReviewRows(alignSubtitles(local, [], matchingSettings.current));
      return;
    }
    replaceReviewRows(alignPlaylist(local, references, matchingSettings.current));
  }

  function parseSrtSource(text: string): SubtitleEntry[] {
    if (!text.trim()) throw new Error('SRT 文件不能为空');
    const parsed = parseSubtitle(text, 'srt');
    if (!parsed.length) throw new Error('未找到有效的 SRT 字幕');
    return parsed;
  }

  function commitSourceText(text: string, name = fileName) {
    sourceLoadRequestId.current += 1;
    try {
      const parsed = parseSrtSource(text);
      setSourceText(text);
      setDraftSourceText(text);
      setFileName(name);
      setSourceView('srt');
      setEntries(parsed);
      resetReviewState();
      if (matchMode === 'playlist') {
        applyPlaylistAlignment(playlistTracks, parsed);
      } else {
        replaceReviewRows(alignSubtitles(parsed, referenceLines, matchingSettings.current));
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法解析字幕');
    }
  }

  function updateSrtDraft(text: string) {
    setDraftSourceText(text);
    setError('');
  }

  function handleSourceTabKeydown(event: ReactKeyboardEvent<HTMLButtonElement>, currentView: SourceView) {
    const nextView = event.key === 'Home' || (event.key === 'ArrowLeft' && currentView === 'txt')
      ? 'srt'
      : event.key === 'End' || (event.key === 'ArrowRight' && currentView === 'srt')
        ? 'txt'
        : null;
    if (!nextView) return;
    event.preventDefault();
    setSourceView(nextView);
  }

  function confirmSrtEdit() {
    if (draftSourceText === sourceText) return;
    commitSourceText(draftSourceText);
  }

  async function loadSourceFile(file: File) {
    const requestId = ++sourceLoadRequestId.current;
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setError('仅支持 SRT 文件导入');
      return;
    }
    try {
      const text = await file.text();
      if (requestId !== sourceLoadRequestId.current) return;
      commitSourceText(text, file.name);
    } catch (cause) {
      if (requestId !== sourceLoadRequestId.current) return;
      setError(cause instanceof Error ? cause.message : '无法读取 SRT 文件');
    }
  }

  function loadAudioFile(file: File) {
    if (!isAudioFile(file)) {
      setError('仅支持音频文件导入');
      return;
    }
    setAudioUrl(URL.createObjectURL(file));
    setAudioName(file.name);
    rowPlaybackEndRef.current = null;
    setActivePlaybackRowId(null);
    setCurrentAudioRowId(null);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setIsAudioPlaying(false);
    setError('');
  }

  function isAudioFile(file: File) {
    return file.type.startsWith('audio/') || /\.(aac|flac|m4a|mp3|ogg|wav|webm)$/i.test(file.name);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadSourceFile(file);
    event.target.value = '';
  }

  function onAudioFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) loadAudioFile(file);
    event.target.value = '';
  }

  function onSourceDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  }

  function onSourceDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
  }

  async function onSourceDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    await Promise.all(files.map((file) => isAudioFile(file) ? loadAudioFile(file) : loadSourceFile(file)));
  }

  function toggleAudioPlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      const result = audio.play();
      result?.catch(() => setError('无法播放音频，请检查文件格式或浏览器权限'));
    } else {
      audio.pause();
    }
  }

  function stepAudio(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    rowPlaybackEndRef.current = null;
    setActivePlaybackRowId(null);
    setCurrentAudioRowId(null);
    const maxTime = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.POSITIVE_INFINITY;
    const nextTime = Math.min(maxTime, Math.max(0, audio.currentTime + seconds));
    audio.currentTime = nextTime;
    setCurrentAudioRowId(findAudioRowId(nextTime * 1_000));
    setAudioCurrentTime(nextTime);
  }

  function seekAudio(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    rowPlaybackEndRef.current = null;
    setActivePlaybackRowId(null);
    setCurrentAudioRowId(null);
    audio.currentTime = value;
    setCurrentAudioRowId(findAudioRowId(value * 1_000));
    setAudioCurrentTime(value);
  }

  function changeAudioVolume(value: number) {
    const audio = audioRef.current;
    if (audio) audio.volume = value;
    setAudioVolume(value);
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (matchMode !== 'single') return;
    const requestId = ++lyricRequestId.current;
    const fallback = entries[0]?.text ?? '';
    const nextQuery = query.trim() || fallback;
    setQuery(nextQuery);
    setIsSearching(true);
    setError('');
    try {
      const nextSongs = await searchNetease(nextQuery);
      if (requestId !== lyricRequestId.current) return;
      setSongs(nextSongs);
    } catch (cause) {
      if (requestId !== lyricRequestId.current) return;
      setSongs([]);
      setError(cause instanceof Error ? cause.message : '搜索失败');
    } finally {
      if (requestId === lyricRequestId.current) setIsSearching(false);
    }
  }

  async function searchPlaylistTrack(trackId: string, queryText: string, requestId: number, version: number): Promise<PlaylistTrackState | null> {
    updatePlaylistTrack(trackId, (track) => ({ ...track, query: queryText, status: 'searching', error: undefined }));
    try {
      const candidates = await searchNetease(queryText);
      if (!isCurrentPlaylistOperation(trackId, version, requestId)) return null;
      const selectedSong = candidates[0] ?? null;
      return updatePlaylistTrack(trackId, (track) => ({
        ...track,
        query: queryText,
        candidates,
        selectedSong,
        referenceLines: [],
        status: selectedSong ? 'search-ready' : 'error',
        error: selectedSong ? undefined : '没有找到候选歌曲',
      }));
    } catch (cause) {
      if (!isCurrentPlaylistOperation(trackId, version, requestId)) return null;
      return updatePlaylistTrack(trackId, (track) => ({
        ...track,
        query: queryText,
        candidates: [],
        selectedSong: null,
        referenceLines: [],
        status: 'error',
        error: cause instanceof Error ? cause.message : '搜索失败',
      }));
    }
  }

  async function loadPlaylistTrackLyric(trackId: string, song: NeteaseSong, requestId: number, version: number): Promise<PlaylistTrackState | null> {
    try {
      const lyric = await fetchNeteaseLyric(song.id);
      if (!isCurrentPlaylistOperation(trackId, version, requestId)) return null;
      const lines = stripLyricTimestamps(lyric);
      return updatePlaylistTrack(trackId, (track) => lines.length > 0
        ? { ...track, selectedSong: song, referenceLines: lines, status: 'ready', error: undefined }
        : { ...track, selectedSong: song, referenceLines: [], status: 'error', error: '没有可用歌词' });
    } catch (cause) {
      if (!isCurrentPlaylistOperation(trackId, version, requestId)) return null;
      return updatePlaylistTrack(trackId, (track) => ({
        ...track,
        selectedSong: song,
        referenceLines: [],
        status: 'error',
        error: cause instanceof Error ? cause.message : '歌词获取失败',
      }));
    }
  }

  async function waitForPlaylistRetries(requestId: number) {
    while (requestId === lyricRequestId.current) {
      const snapshot = Array.from(playlistRetryPromisesRef.current.entries());
      await Promise.all(snapshot.map(([, promise]) => promise));
      const current = playlistRetryPromisesRef.current;
      if (snapshot.length === current.size && snapshot.every(([trackId, promise]) => current.get(trackId) === promise)) return;
    }
  }

  async function handlePlaylistSearch(playlistText: string) {
    if (matchMode !== 'playlist') return;
    const queries = parsePlaylistQueries(playlistText);
    if (queries.length === 0) {
      replacePlaylistTracks([]);
      replaceReviewRows(alignSubtitles(entries, [], matchingSettings.current));
      setReferenceLines([]);
      exportAnchorIdRef.current = null;
      setError('请先输入歌单，每行一首歌曲');
      return;
    }

    const requestId = ++lyricRequestId.current;
    const initialTracks: PlaylistTrackState[] = queries.map((queryText, index) => ({
      id: `playlist-${index}`,
      query: queryText,
      candidates: [],
      selectedSong: null,
      referenceLines: [],
      status: 'queued',
    }));
    playlistOperationVersionsRef.current.clear();
    playlistRetryPromisesRef.current.clear();
    playlistSearchPhaseRef.current = true;
    replacePlaylistTracks(initialTracks);
    replaceReviewRows([]);
    setReferenceLines([]);
    setSongs([]);
    setSelectedSong(null);
    setIsMatchingPlaylist(true);
    setIsSearchingPlaylist(true);
    setIsLoadingLyric(false);
    setIsSearching(false);
    setError('');
    const throttleOptions = getPlaylistThrottleOptions(queries.length);

    const initialSearchPromise = runThrottled(initialTracks, async (track) => {
      const version = nextPlaylistOperationVersion(track.id);
      return searchPlaylistTrack(track.id, track.query, requestId, version);
    }, throttleOptions);
    playlistInitialSearchPromiseRef.current = initialSearchPromise;
    await initialSearchPromise;
    if (playlistInitialSearchPromiseRef.current === initialSearchPromise) playlistInitialSearchPromiseRef.current = null;
    if (requestId !== lyricRequestId.current) return;
    await waitForPlaylistRetries(requestId);
    if (requestId !== lyricRequestId.current) return;

    playlistSearchPhaseRef.current = false;
    setIsSearchingPlaylist(false);
    const tracksForLyrics = playlistTracksRef.current.map((track) => track.selectedSong
      ? { ...track, status: 'lyric-loading' as const, error: undefined }
      : track);
    replacePlaylistTracks(tracksForLyrics);
    await runThrottled(tracksForLyrics, async (track) => {
      if (!track.selectedSong) return track;
      const version = playlistOperationVersionsRef.current.get(track.id) ?? 0;
      return loadPlaylistTrackLyric(track.id, track.selectedSong, requestId, version);
    }, { ...throttleOptions, delayFirst: true });
    if (requestId !== lyricRequestId.current) return;
    const loadedTracks = playlistTracksRef.current;
    applyPlaylistAlignment(loadedTracks);
    const failedTracks = loadedTracks.filter((track) => track.status === 'error');
    setError(failedTracks.length > 0 ? `${failedTracks.length} 首歌曲未能获取歌词，已跳过并保留其它歌曲匹配结果` : '');
    setIsMatchingPlaylist(false);
  }

  async function retryPlaylistTrack(trackIndex: number, queryText: string) {
    if (matchMode !== 'playlist') return;
    const track = playlistTracksRef.current[trackIndex];
    const nextQuery = queryText.trim();
    if (!track || !nextQuery) return;
    const requestId = lyricRequestId.current;
    const version = nextPlaylistOperationVersion(track.id);
    const initialSearchPromise = playlistInitialSearchPromiseRef.current;
    updatePlaylistTrack(track.id, (current) => ({
      ...current,
      query: nextQuery,
      candidates: [],
      selectedSong: null,
      referenceLines: [],
      status: 'queued',
      error: undefined,
    }));
    const retryOptions = { ...getPlaylistThrottleOptions(playlistTracksRef.current.length), delayFirst: true };
    const retryPromise = enqueuePlaylistManualRequest(async () => {
      if (initialSearchPromise) await initialSearchPromise;
      if (!isCurrentPlaylistOperation(track.id, version, requestId)) return null;
      const [searchedTrack] = await runThrottled([track.id], async () => searchPlaylistTrack(track.id, nextQuery, requestId, version), retryOptions);
      if (!searchedTrack || !isCurrentPlaylistOperation(track.id, version, requestId) || playlistSearchPhaseRef.current) return searchedTrack;
      if (!searchedTrack.selectedSong) {
        applyPlaylistAlignment(playlistTracksRef.current);
        setError(searchedTrack.error ?? '搜索失败');
        return searchedTrack;
      }
      updatePlaylistTrack(track.id, (current) => ({ ...current, status: 'lyric-loading', error: undefined }));
      await runThrottled([searchedTrack.selectedSong], async (song) => loadPlaylistTrackLyric(track.id, song, requestId, version), retryOptions);
      if (!isCurrentPlaylistOperation(track.id, version, requestId)) return null;
      applyPlaylistAlignment(playlistTracksRef.current);
      const currentTrack = playlistTracksRef.current[trackIndex];
      setError(currentTrack?.status === 'error' ? currentTrack.error ?? '歌词获取失败' : '');
      return currentTrack ?? null;
    });
    playlistRetryPromisesRef.current.set(track.id, retryPromise);
    await retryPromise;
  }

  async function chooseSong(song: NeteaseSong) {
    if (matchMode !== 'single') return;
    const requestId = ++lyricRequestId.current;
    setSelectedSong(song);
    setIsLoadingLyric(true);
    exportAnchorIdRef.current = null;
    setError('');
    try {
      const lyric = await fetchNeteaseLyric(song.id);
      if (requestId !== lyricRequestId.current) return;
      const lines = stripLyricTimestamps(lyric);
      setReferenceLines(lines);
      replaceReviewRows(alignSubtitles(entries, lines, matchingSettings.current));
    } catch (cause) {
      if (requestId !== lyricRequestId.current) return;
      replaceReviewRows(alignSubtitles(entries, [], matchingSettings.current));
      setReferenceLines([]);
      setError(cause instanceof Error ? cause.message : '歌词获取失败');
    } finally {
      if (requestId === lyricRequestId.current) setIsLoadingLyric(false);
    }
  }

  async function choosePlaylistSong(trackIndex: number, songId: number) {
    if (matchMode !== 'playlist') return;
    const track = playlistTracksRef.current[trackIndex];
    const song = track?.candidates.find((candidate) => candidate.id === songId);
    if (!track || !song) return;
    const requestId = lyricRequestId.current;
    const version = nextPlaylistOperationVersion(track.id);
    if (playlistSearchPhaseRef.current) {
      updatePlaylistTrack(track.id, (current) => ({ ...current, selectedSong: song, referenceLines: [], status: 'search-ready', error: undefined }));
      return;
    }
    updatePlaylistTrack(track.id, (current) => ({ ...current, selectedSong: song, referenceLines: [], status: 'lyric-loading', error: undefined }));
    exportAnchorIdRef.current = null;
    setError('');
    const retryOptions = { ...getPlaylistThrottleOptions(playlistTracksRef.current.length), delayFirst: true };
    await enqueuePlaylistManualRequest(async () => {
      if (!isCurrentPlaylistOperation(track.id, version, requestId)) return;
      await runThrottled([song], async (selected) => loadPlaylistTrackLyric(track.id, selected, requestId, version), retryOptions);
      if (!isCurrentPlaylistOperation(track.id, version, requestId)) return;
      applyPlaylistAlignment(playlistTracksRef.current);
      const currentTrack = playlistTracksRef.current[trackIndex];
      setError(currentTrack?.status === 'error' ? currentTrack.error ?? '歌词获取失败' : '');
    });
  }

  function changeMatchingAlgorithm(algorithm: MatchingAlgorithm) {
    matchingSettings.current = { ...matchingSettings.current, algorithm };
    setMatchingAlgorithm(algorithm);
    if (matchMode === 'playlist' && !isMatchingPlaylist) {
      applyPlaylistAlignment(playlistTracks);
    } else if (selectedSong && !isLoadingLyric) {
      exportAnchorIdRef.current = null;
      replaceReviewRows(alignSubtitles(entries, referenceLines, { algorithm, smartSegmentation }));
    }
  }

  function changeSmartSegmentation(enabled: boolean) {
    matchingSettings.current = { ...matchingSettings.current, smartSegmentation: enabled };
    setSmartSegmentation(enabled);
    if (matchMode === 'playlist' && !isMatchingPlaylist) {
      applyPlaylistAlignment(playlistTracks);
    } else if (selectedSong && !isLoadingLyric) {
      exportAnchorIdRef.current = null;
      replaceReviewRows(alignSubtitles(entries, referenceLines, { algorithm: matchingAlgorithm, smartSegmentation: enabled }));
    }
  }

  const updateRow = useCallback((id: string, patch: Partial<AlignmentRow>) => {
    const rowIndex = rowIndexByIdRef.current.get(id);
    if (rowIndex === undefined) return;
    const nextRows = rowsRef.current.slice();
    nextRows[rowIndex] = { ...nextRows[rowIndex], ...patch };
    rowsRef.current = nextRows;
  }, []);

  const toggleExport = useCallback((id: string, checked: boolean, shiftKey: boolean) => {
    const currentRows = rowsRef.current;
    const rowIndex = rowIndexByIdRef.current.get(id);
    if (rowIndex === undefined) return;
    const anchorIndex = shiftKey && exportAnchorIdRef.current
      ? rowIndexByIdRef.current.get(exportAnchorIdRef.current) ?? -1
      : -1;
    const rangeStart = anchorIndex >= 0 ? Math.min(anchorIndex, rowIndex) : rowIndex;
    const rangeEnd = anchorIndex >= 0 ? Math.max(anchorIndex, rowIndex) : rowIndex;
    if (!shiftKey || anchorIndex < 0) exportAnchorIdRef.current = id;
    if (!shiftKey || anchorIndex < 0) {
      const nextRows = currentRows.slice();
      nextRows[rowIndex] = { ...nextRows[rowIndex], includeInExport: checked };
      rowsRef.current = nextRows;
      return;
    }
    const nextRows = currentRows.map((row, index) => index >= rangeStart && index <= rangeEnd
      ? { ...row, includeInExport: checked }
      : row);
    rowsRef.current = nextRows;
    setRows(nextRows);
  }, []);

  const chooseRow = useCallback((row: AlignmentRow, choice: 'local' | 'reference') => {
    updateRow(row.id, { chosenText: choice === 'reference' ? row.referenceText : row.localText });
  }, [updateRow]);

  const copyReference = useCallback(async (row: AlignmentRow, lineText: string, lineIndex: number) => {
    if (!lineText) return;
    try {
      await copyText(lineText);
      setCopiedLine({ rowId: row.id, lineIndex });
      window.setTimeout(() => setCopiedLine((current) => current?.rowId === row.id && current.lineIndex === lineIndex ? null : current), 1_500);
    } catch {
      setError('无法写入剪贴板，请检查浏览器权限');
    }
  }, []);

  const pasteRow = useCallback(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      setError('无法读取剪贴板，请检查浏览器权限');
      return null;
    }
  }, []);

  const playRow = useCallback((row: AlignmentRow) => {
    const entry = entriesById.get(row.localIds[0]);
    const audio = audioRef.current;
    if (!entry || entry.startMs === undefined || !audio) return;
    rowPlaybackEndRef.current = entry.endMs === undefined ? null : entry.endMs / 1000;
    setActivePlaybackRowId(row.id);
    setCurrentAudioRowId(row.id);
    audio.currentTime = entry.startMs / 1000;
    setAudioCurrentTime(audio.currentTime);
    const result = audio.play();
    result?.catch(() => setError('无法播放音频，请检查文件格式或浏览器权限'));
  }, [entriesById]);

  function findAudioRowId(timeMs: number): string | null {
    const timelineRows = rowsRef.current.map((row) => {
      const localEntries = row.localIds.map((id) => entriesById.get(id)).filter((entry): entry is SubtitleEntry => entry !== undefined);
      const startTimes = localEntries.flatMap((entry) => entry.startMs === undefined ? [] : [entry.startMs]);
      const endTimes = localEntries.flatMap((entry) => entry.endMs === undefined ? [] : [entry.endMs]);
      return {
        row,
        startMs: startTimes.length > 0 ? Math.min(...startTimes) : undefined,
        endMs: endTimes.length > 0 ? Math.max(...endTimes) : undefined,
      };
    });
    const currentRow = timelineRows.find(({ startMs, endMs }) => startMs !== undefined && startMs <= timeMs && (endMs === undefined || timeMs < endMs));
    if (currentRow) return currentRow.row.id;
    const nextRow = timelineRows
      .filter(({ startMs }) => startMs !== undefined && startMs > timeMs)
      .sort((left, right) => left.startMs! - right.startMs!)[0];
    return nextRow?.row.id ?? null;
  }

  function handleAudioTimeUpdate(event: SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget;
    const rowEnd = rowPlaybackEndRef.current;
    if (rowEnd !== null && audio.currentTime >= rowEnd) {
      audio.currentTime = rowEnd;
      rowPlaybackEndRef.current = null;
      setActivePlaybackRowId(null);
      setCurrentAudioRowId(activePlaybackRowId ?? findAudioRowId(rowEnd * 1_000));
      audio.pause();
      setAudioCurrentTime(rowEnd);
      return;
    }
    const nextAudioRowId = findAudioRowId(audio.currentTime * 1_000);
    if (nextAudioRowId !== currentAudioRowId) {
      setCurrentAudioRowId(nextAudioRowId);
      if (lyricFollowEnabled && isAudioPlaying && activePlaybackRowId === null && nextAudioRowId) {
          const element = Array.from(document.querySelectorAll<HTMLElement>('.diff-row')).find((candidate) => candidate.dataset.rowId === nextAudioRowId);
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setAudioCurrentTime(audio.currentTime);
  }

  function download() {
    const blob = new Blob([buildExportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileName.replace(/\.(srt|txt)$/i, '')}-校对.${exportKind}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={`shell ${audioUrl ? 'has-audio' : ''}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">↔</span>
          <div>
            <p className="eyebrow">CONCERT TRANSCRIPT WORKBENCH</p>
            <h1>Lyric CoCorrect</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="status-dot" aria-hidden="true" />
          <span>本地工作区</span>
          <span className="meta-divider" />
          <span>{fileName}</span>
        </div>
      </header>

      {audioUrl && <div className="audio-player" role="region" aria-label="音频播放器">
        <audio ref={audioRef} className="audio-engine" src={audioUrl} preload="metadata" onLoadedMetadata={(event) => setAudioDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={handleAudioTimeUpdate} onPlay={() => setIsAudioPlaying(true)} onPause={() => { rowPlaybackEndRef.current = null; setActivePlaybackRowId(null); setIsAudioPlaying(false); }} onEnded={() => { rowPlaybackEndRef.current = null; setActivePlaybackRowId(null); setIsAudioPlaying(false); }} />
        <div className="audio-player-heading"><strong>{audioName}</strong><span>{formatAudioTime(audioCurrentTime)} / {formatAudioTime(audioDuration)}</span></div>
        <div className="audio-player-controls">
          <button type="button" className="audio-play-toggle" onClick={toggleAudioPlayback} aria-label={isAudioPlaying ? '暂停音频' : '播放音频'}>{isAudioPlaying ? '暂停' : '播放'}</button>
          <button type="button" className="audio-step" data-audio-step="-10" onClick={() => stepAudio(-10)} aria-label="后退 10 秒">-10</button>
          <button type="button" className="audio-step" data-audio-step="-5" onClick={() => stepAudio(-5)} aria-label="后退 5 秒">-5</button>
          <input className="audio-seek" type="range" min="0" max={audioDuration || 0} step="0.01" value={Math.min(audioCurrentTime, audioDuration || 0)} onChange={(event) => seekAudio(Number(event.target.value))} aria-label="音频进度" disabled={!audioDuration} />
          <button type="button" className="audio-step" data-audio-step="5" onClick={() => stepAudio(5)} aria-label="前进 5 秒">+5</button>
          <button type="button" className="audio-step" data-audio-step="10" onClick={() => stepAudio(10)} aria-label="前进 10 秒">+10</button>
          <label className="audio-volume"><span>音量</span><input type="range" min="0" max="1" step="0.05" value={audioVolume} onChange={(event) => changeAudioVolume(Number(event.target.value))} aria-label="音量" /></label>
          <label className="audio-follow-toggle"><input type="checkbox" checked={lyricFollowEnabled} onChange={(event) => setLyricFollowEnabled(event.target.checked)} aria-label="歌词跟随" /><span>歌词跟随</span></label>
          <button type="button" className="audio-clear" onClick={() => { audioRef.current?.pause(); rowPlaybackEndRef.current = null; setActivePlaybackRowId(null); setCurrentAudioRowId(null); setAudioUrl(null); setAudioName(''); setAudioCurrentTime(0); setAudioDuration(0); setIsAudioPlaying(false); }} aria-label="移除音频">移除</button>
        </div>
      </div>}

      <section className="intro-band">
        <div>
          <p className="section-kicker">01 / IMPORT</p>
          <h2>把现场听见的，和正式歌词放在一起。</h2>
          <p className="intro-copy">导入剪映识别字幕，搜索网易云参考歌词。每一处差异都交给你确认，现场改词和重复副歌不会被自动抹掉。</p>
        </div>
        <div className="workflow-rail" aria-label="处理流程">
          <span className="workflow-active">导入</span><i />
          <span className={rows.length ? 'workflow-active' : ''}>对齐</span><i />
          <span>导出</span>
        </div>
      </section>

      <section className="workspace-grid import-grid">
        <div className={`panel source-panel ${isDragging ? 'dragging' : ''}`} onDragOver={onSourceDragOver} onDragLeave={onSourceDragLeave} onDrop={onSourceDrop}>
          <div className={`source-dropzone ${isDragging ? 'dragging' : ''}`} role="region" aria-label="SRT 与音频文件导入区域">
            <div className="panel-heading">
              <div><p className="section-kicker">现场文本</p><h3>剪映识别结果</h3></div>
              <div className="source-upload-actions"><button type="button" className="upload-button" onClick={() => sourceFileInputRef.current?.click()}>选择 SRT</button><input ref={sourceFileInputRef} className="source-file-input" type="file" tabIndex={-1} aria-hidden="true" accept=".srt,application/x-subrip" onChange={onFileChange} /><button type="button" className="audio-upload-button" onClick={() => audioFileInputRef.current?.click()}>选择音频</button><input ref={audioFileInputRef} className="source-file-input audio-file-input" type="file" tabIndex={-1} aria-hidden="true" accept="audio/*" onChange={onAudioFileChange} /></div>
            </div>
            <p className="source-drop-hint">拖动 SRT 与音频文件到这里，或分别选择文件导入</p>
            <div className="segmented" role="tablist" aria-label="源文本视图">
              <button id="source-view-srt" type="button" role="tab" aria-controls="source-srt-panel" aria-selected={sourceView === 'srt'} tabIndex={sourceView === 'srt' ? 0 : -1} className={sourceView === 'srt' ? 'selected' : ''} onClick={() => setSourceView('srt')} onKeyDown={(event) => handleSourceTabKeydown(event, 'srt')}>SRT 编辑</button>
              <button id="source-view-txt" type="button" role="tab" aria-controls="source-txt-panel" aria-selected={sourceView === 'txt'} tabIndex={sourceView === 'txt' ? 0 : -1} className={sourceView === 'txt' ? 'selected' : ''} onClick={() => setSourceView('txt')} onKeyDown={(event) => handleSourceTabKeydown(event, 'txt')}>TXT 只读</button>
            </div>
            <div id={sourceView === 'srt' ? 'source-srt-panel' : 'source-txt-panel'} role="tabpanel" aria-labelledby={sourceView === 'srt' ? 'source-view-srt' : 'source-view-txt'}>
              {sourceView === 'srt' ? <textarea value={draftSourceText} onChange={(event) => updateSrtDraft(event.target.value)} aria-label="剪映识别结果 SRT" /> : <textarea value={parsedTxt} readOnly aria-label="解析后的 TXT" />}
            </div>
            {hasDraftChanges && <div className="source-edit-actions"><span>修改尚未成为识别结果</span><button type="button" className="confirm-source" onClick={confirmSrtEdit}>确定修改</button></div>}
            <div className="panel-foot"><span>{entries.length} 行已解析</span><span>{hasTimeline ? '时间轴已保留' : '未解析'}</span></div>
          </div>
        </div>

        <div className="panel match-panel">
          <div className="panel-heading"><div><p className="section-kicker">参考来源</p><h3>网易云歌词</h3></div><span className="service-pill">联网搜索</span></div>
          <div className="matching-mode segmented" role="tablist" aria-label="匹配模式">
            <button type="button" role="tab" aria-label="普通模式" aria-selected={matchMode === 'single'} className={matchMode === 'single' ? 'selected' : ''} onClick={() => changeMatchMode('single')}>普通模式</button>
            <button type="button" role="tab" aria-label="歌单模式" aria-selected={matchMode === 'playlist'} className={matchMode === 'playlist' ? 'selected' : ''} onClick={() => changeMatchMode('playlist')}>歌单模式</button>
          </div>
          {matchMode === 'single' ? <>
            <form className="search-form" onSubmit={handleSearch}>
              <label htmlFor="song-query">歌名 / 歌手 / 歌词片段</label>
              <div className="search-row"><input id="song-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：歌名 - 歌手" /><button type="submit" disabled={isSearching}>{isSearching ? '搜索中…' : '搜索'}</button></div>
            </form>
            <div className="candidate-list">
              {songs.length === 0 && <p className="empty-note">搜索结果会显示在这里。没有网络时仍可先整理现场文本。</p>}
              {songs.map((song) => <button type="button" className={`candidate ${selectedSong?.id === song.id ? 'chosen' : ''}`} key={song.id} onClick={() => chooseSong(song)}><span><strong>{song.name}</strong><small>{song.artists} · {song.album}</small></span><span aria-hidden="true">{selectedSong?.id === song.id ? '✓' : '→'}</span></button>)}
            </div>
          </> : <PlaylistMatchPanel initialValue={playlistDraftRef.current} isMatchingPlaylist={isMatchingPlaylist} isSearchingPlaylist={isSearchingPlaylist} playlistTracks={playlistTracks} onDraftChange={(value) => { playlistDraftRef.current = value; }} onSubmit={handlePlaylistSearch} onChooseSong={choosePlaylistSong} onRetryTrack={retryPlaylistTrack} />}
        </div>
      </section>

      {error && <div className="notice error" role="alert"><strong>需要注意</strong><span>{error}</span><button onClick={() => setError('')} aria-label="关闭提示">×</button></div>}

      <section className="review-section">
        <div className="review-heading"><div><p className="section-kicker">02 / REVIEW</p><h2>逐句对照</h2><p>{matchMode === 'playlist' ? (playlistTracks.length ? `歌单模式 · ${playlistTracks.length} 首` : '切换到歌单模式并加载演出顺序') : selectedSong ? `${selectedSong.name} · ${selectedSong.artists}` : '选择一首参考歌曲后开始对齐'}</p></div><div className="review-actions"><div className="stats"><span><b>{diffStats.change}</b> 差异</span><span><b>{diffStats.add}</b> 参考新增</span><span><b>{diffStats.remove}</b> 现场独有</span></div><select value={exportKind} onChange={(event) => setExportKind(event.target.value as ExportKind)} aria-label="导出格式"><option value="srt">导出 SRT</option><option value="txt">导出 TXT</option></select><button className="preview-action" onClick={() => setPreviewOpen(true)} disabled={!entries.length} aria-label="预览校对稿">预览</button><button className="primary-action" onClick={download} disabled={!entries.length}>下载校对稿 ↓</button></div></div>
        <div className="review-settings">
          <label htmlFor="matching-algorithm">对比算法</label>
          <select id="matching-algorithm" aria-label="对比算法" value={matchingAlgorithm} onChange={(event) => changeMatchingAlgorithm(event.target.value as MatchingAlgorithm)} title="切换算法会重置逐行修改">
            <option value="fragment">片段匹配</option>
            <option value="from-start">从头匹配</option>
          </select>
          <label className="segmentation-toggle" title="切换智能分句会重置逐行修改"><input type="checkbox" aria-label="智能分句" checked={smartSegmentation} onChange={(event) => changeSmartSegmentation(event.target.checked)} />智能分句</label>
        </div>
        <div className="diff-header"><span aria-hidden="true" /><span>剪映现场版</span><span>网易云参考版</span><span>处理</span></div>
        <div className={`review-layout ${matchMode === 'playlist' && playlistTracks.length > 1 ? 'has-outline' : ''}`}>
          {matchMode === 'playlist' && playlistTracks.length > 1 && <ReviewOutline rows={rows} playlistTracks={playlistTracks} currentAudioRowId={currentAudioRowId} />}
          <ReviewTable isLoadingLyric={isLoadingLyric} isMatchingPlaylist={isMatchingPlaylist} isSearchingPlaylist={isSearchingPlaylist} matchMode={matchMode} rows={rows} playlistTracks={playlistTracks} entriesById={entriesById} hasAudio={audioUrl !== null} copiedLine={copiedLine} activePlaybackRowId={activePlaybackRowId} currentAudioRowId={currentAudioRowId} onChooseRow={chooseRow} onUpdateRow={updateRow} onToggleExport={toggleExport} onCopyReference={copyReference} onPasteRow={pasteRow} onPlayRow={playRow} />
        </div>
      </section>

      <footer className="footer-note"><span>原始字幕不会被覆盖</span><span>·</span><span>网易云歌词仅作为参考</span><span>·</span><span>所有行按勾选结果导出</span></footer>
      {previewOpen && <div className="preview-overlay" onClick={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title"><div className="preview-heading"><div><h3 id="preview-title">导出预览</h3><span>{exportKind.toUpperCase()}</span></div><button ref={previewCloseRef} type="button" onClick={() => setPreviewOpen(false)} aria-label="关闭预览">关闭</button></div>{previewText.trim() ? <pre className="preview-content">{previewText}</pre> : <p className="preview-empty">没有可导出的字幕</p>}</section></div>}
    </main>
  );
}

export default App;
