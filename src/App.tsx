import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { alignSubtitles, type AlignmentRow } from './lib/alignment';
import type { MatchingAlgorithm } from './lib/matchingAlgorithms';
import { copyText, splitReferenceLines } from './lib/clipboard';
import { alignPlaylist, type PlaylistAlignmentRow, type PlaylistTrackReference } from './lib/playlistMatching';
import { runThrottled } from './lib/requestScheduler';
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
  status: 'loading' | 'ready' | 'error';
  error?: string;
};

const starterSrt = `1\n00:00:01,000 --> 00:00:03,000\n把酒倒满\n\n2\n00:00:04,000 --> 00:00:06,000\n朋友一生一起走\n\n3\n00:00:07,000 --> 00:00:09,000\n那些日子不再有`;

function parsePlaylistQueries(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

type PlaylistMatchPanelProps = {
  initialValue: string;
  isMatchingPlaylist: boolean;
  playlistTracks: PlaylistTrackState[];
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onChooseSong: (trackIndex: number, songId: number) => void;
};

export function PlaylistMatchPanel({ initialValue, isMatchingPlaylist, playlistTracks, onDraftChange, onSubmit, onChooseSong }: PlaylistMatchPanelProps) {
  const [playlistDraft, setPlaylistDraft] = useState(initialValue);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(playlistDraft);
  }

  function handleDraftChange(value: string) {
    setPlaylistDraft(value);
    onDraftChange(value);
  }

  return <>
    <form className="playlist-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="playlist">演唱会歌单（每行一首，按演出顺序）</label>
      <textarea id="playlist" className="playlist-input" value={playlistDraft} onChange={(event) => handleDraftChange(event.target.value)} placeholder="例如：歌名 - 歌手\n下一首歌 - 歌手" />
      <div className="search-row playlist-submit"><button type="submit" disabled={isMatchingPlaylist}>{isMatchingPlaylist ? '匹配中…' : '按歌单匹配'}</button></div>
    </form>
    <div className="playlist-track-list">
      {playlistTracks.length === 0 && <p className="empty-note">输入歌单后，工具会按顺序搜索每首歌并自动分段。</p>}
      {playlistTracks.map((track, trackIndex) => <div className="playlist-track" key={track.id}>
        <div className="playlist-track-heading"><span className="playlist-track-number">{String(trackIndex + 1).padStart(2, '0')}</span><div><strong>{track.query}</strong><small>{track.status === 'loading' ? '正在获取歌词…' : track.status === 'ready' ? `${track.selectedSong?.name ?? track.query} · ${track.selectedSong?.artists ?? ''}` : track.error}</small></div></div>
        {track.candidates.length > 0 && <select aria-label={`选择第 ${trackIndex + 1} 首歌曲`} value={track.selectedSong?.id ?? ''} disabled={isMatchingPlaylist} onChange={(event) => onChooseSong(trackIndex, Number(event.target.value))}>{track.candidates.map((song) => <option key={song.id} value={song.id}>{song.name} · {song.artists}</option>)}</select>}
      </div>)}
    </div>
  </>;
}

type ReviewRowProps = {
  row: PlaylistAlignmentRow;
  index: number;
  showTrackHeading: boolean;
  track?: PlaylistTrackState;
  copiedLineKey: string | null;
  onChooseRow: (row: AlignmentRow, choice: 'local' | 'reference') => void;
  onUpdateRow: (id: string, patch: Partial<AlignmentRow>) => void;
  onCopyReference: (row: AlignmentRow, lineText: string, lineIndex: number) => void;
};

const ReviewRow = memo(function ReviewRow({ row, index, showTrackHeading, track, copiedLineKey, onChooseRow, onUpdateRow, onCopyReference }: ReviewRowProps) {
  return <Fragment>
    {showTrackHeading && <div className="playlist-section-heading"><span>{String((row.trackIndex ?? 0) + 1).padStart(2, '0')}</span><strong>{track?.selectedSong?.name ?? track?.query ?? '歌单歌曲'}</strong><small>{track?.selectedSong?.artists}</small></div>}
    <div className={`diff-row ${row.kind}`}>
      <div className="line-number">{String(index + 1).padStart(2, '0')}</div>
      <div className="diff-cell local"><span>{row.localText || '—'}</span></div>
      <div className="diff-cell reference">{row.referenceText ? <div className="reference-lines">{splitReferenceLines(row.referenceText).map((lineText, lineIndex) => { const lineKey = `${row.id}-${lineIndex}`; return <div className="reference-line" key={lineKey}><span>{lineText}</span><button type="button" className="copy-reference" onClick={() => onCopyReference(row, lineText, lineIndex)} aria-label={`复制第 ${index + 1} 行网易云歌词的第 ${lineIndex + 1} 句`}>{copiedLineKey === lineKey ? '已复制' : '复制'}</button></div>; })}</div> : <span>—</span>}</div>
      <div className="row-controls">
        <button type="button" onClick={() => onChooseRow(row, 'local')} className={row.chosenText === row.localText ? 'active' : ''} disabled={row.kind === 'add'}>现场</button>
        <button type="button" onClick={() => onChooseRow(row, 'reference')} className={row.chosenText === row.referenceText && Boolean(row.referenceText) ? 'active reference-choice' : ''} disabled={!row.referenceText || row.localIds.length > 1} title={row.localIds.length > 1 ? '多个 SRT 条目合并显示，参考文本仅用于对比' : undefined}>参考</button>
        <input aria-label={`编辑第 ${index + 1} 行`} value={row.chosenText} disabled={row.localIds.length > 1} onChange={(event) => onUpdateRow(row.id, { chosenText: event.target.value })} />
        <label className="export-toggle"><input type="checkbox" aria-label={`导出第 ${index + 1} 行`} checked={row.includeInExport} onChange={(event) => onUpdateRow(row.id, { includeInExport: event.target.checked })} />导出</label>
      </div>
    </div>
  </Fragment>;
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
  const [rows, setRows] = useState<PlaylistAlignmentRow[]>([]);
  const [referenceLines, setReferenceLines] = useState<string[]>([]);
  const [matchingAlgorithm, setMatchingAlgorithm] = useState<MatchingAlgorithm>('fragment');
  const [smartSegmentation, setSmartSegmentation] = useState(true);
  const matchingSettings = useRef({ algorithm: 'fragment' as MatchingAlgorithm, smartSegmentation: true });
  const lyricRequestId = useRef(0);
  const sourceLoadRequestId = useRef(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingLyric, setIsLoadingLyric] = useState(false);
  const [isMatchingPlaylist, setIsMatchingPlaylist] = useState(false);
  const [error, setError] = useState('');
  const [exportKind, setExportKind] = useState<ExportKind>('srt');
  const [isDragging, setIsDragging] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const [copiedLineKey, setCopiedLineKey] = useState<string | null>(null);

  const hasTimeline = entries.some((entry) => entry.startMs !== undefined);
  const diffStats = useMemo(() => rows.reduce((stats, row) => {
    stats[row.kind] += 1;
    return stats;
  }, { equal: 0, change: 0, add: 0, remove: 0 } as Record<AlignmentRow['kind'], number>), [rows]);
  function buildExportText() {
    const output = createExportEntries(entries, rows, exportKind);
    return exportKind === 'srt' ? exportSrt(output) : exportTxt(output);
  }
  const previewText = previewOpen ? buildExportText() : '';
  const parsedTxt = useMemo(() => exportTxt(entries), [entries]);
  const hasDraftChanges = draftSourceText !== sourceText;

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
    setRows([]);
    setReferenceLines([]);
    setSelectedSong(null);
    setPlaylistTracks([]);
    setIsLoadingLyric(false);
    setIsMatchingPlaylist(false);
    setIsSearching(false);
  }

  function changeMatchMode(nextMode: MatchMode) {
    if (nextMode === matchMode) return;
    lyricRequestId.current += 1;
    setMatchMode(nextMode);
    setSongs([]);
    setSelectedSong(null);
    setRows([]);
    setReferenceLines([]);
    setIsLoadingLyric(false);
    setIsMatchingPlaylist(false);
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

  function applyPlaylistAlignment(tracks: PlaylistTrackState[]) {
    const references = playlistReferences(tracks);
    const lines = references.flatMap((track) => track.lines);
    setReferenceLines(lines);
    if (lines.length === 0) {
      setRows([]);
      return;
    }
    setRows(alignPlaylist(entries, references, matchingSettings.current));
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

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadSourceFile(file);
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
    const file = event.dataTransfer.files?.[0];
    if (file) await loadSourceFile(file);
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

  async function handlePlaylistSearch(playlistText: string) {
    if (matchMode !== 'playlist') return;
    const queries = parsePlaylistQueries(playlistText);
    if (queries.length === 0) {
      setPlaylistTracks([]);
      setRows([]);
      setReferenceLines([]);
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
      status: 'loading',
    }));
    setPlaylistTracks(initialTracks);
    setRows([]);
    setReferenceLines([]);
    setSongs([]);
    setSelectedSong(null);
    setIsMatchingPlaylist(true);
    setIsLoadingLyric(false);
    setIsSearching(false);
    setError('');

    const searchedTracks = await runThrottled(initialTracks, async (track) => {
      try {
        const candidates = await searchNetease(track.query);
        const selected = candidates[0] ?? null;
        return {
          ...track,
          candidates,
          selectedSong: selected,
          status: selected ? 'loading' as const : 'error' as const,
          error: selected ? undefined : '没有找到候选歌曲',
        };
      } catch (cause) {
        return {
          ...track,
          status: 'error' as const,
          error: cause instanceof Error ? cause.message : '搜索失败',
        };
      }
    });
    if (requestId !== lyricRequestId.current) return;
    setPlaylistTracks(searchedTracks);

    const loadedTracks = await runThrottled(searchedTracks, async (track) => {
      if (!track.selectedSong) return track;
      try {
        const lyric = await fetchNeteaseLyric(track.selectedSong.id);
        const lines = stripLyricTimestamps(lyric);
        return lines.length > 0
          ? { ...track, referenceLines: lines, status: 'ready' as const, error: undefined }
          : { ...track, status: 'error' as const, error: '没有可用歌词' };
      } catch (cause) {
        return { ...track, status: 'error' as const, error: cause instanceof Error ? cause.message : '歌词获取失败' };
      }
    });
    if (requestId !== lyricRequestId.current) return;
    setPlaylistTracks(loadedTracks);
    applyPlaylistAlignment(loadedTracks);
    const failedTracks = loadedTracks.filter((track) => track.status === 'error');
    if (failedTracks.length > 0) setError(`${failedTracks.length} 首歌曲未能获取歌词，已跳过并保留其它歌曲匹配结果`);
    setIsMatchingPlaylist(false);
  }

  async function chooseSong(song: NeteaseSong) {
    if (matchMode !== 'single') return;
    const requestId = ++lyricRequestId.current;
    setSelectedSong(song);
    setIsLoadingLyric(true);
    setError('');
    try {
      const lyric = await fetchNeteaseLyric(song.id);
      if (requestId !== lyricRequestId.current) return;
      const lines = stripLyricTimestamps(lyric);
      setReferenceLines(lines);
      setRows(alignSubtitles(entries, lines, matchingSettings.current));
    } catch (cause) {
      if (requestId !== lyricRequestId.current) return;
      setRows([]);
      setReferenceLines([]);
      setError(cause instanceof Error ? cause.message : '歌词获取失败');
    } finally {
      if (requestId === lyricRequestId.current) setIsLoadingLyric(false);
    }
  }

  async function choosePlaylistSong(trackIndex: number, songId: number) {
    if (matchMode !== 'playlist') return;
    const track = playlistTracks[trackIndex];
    const song = track?.candidates.find((candidate) => candidate.id === songId);
    if (!track || !song) return;
    const requestId = ++lyricRequestId.current;
    const loadingTracks = playlistTracks.map((item, index) => index === trackIndex
      ? { ...item, selectedSong: song, referenceLines: [], status: 'loading' as const, error: undefined }
      : item);
    setPlaylistTracks(loadingTracks);
    setRows([]);
    setReferenceLines([]);
    setIsMatchingPlaylist(true);
    setError('');
    try {
      const lyric = await fetchNeteaseLyric(song.id);
      if (requestId !== lyricRequestId.current) return;
      const lines = stripLyricTimestamps(lyric);
      const nextTracks = loadingTracks.map((item, index) => index === trackIndex
        ? lines.length > 0
          ? { ...item, referenceLines: lines, status: 'ready' as const }
          : { ...item, status: 'error' as const, error: '没有可用歌词' }
        : item);
      setPlaylistTracks(nextTracks);
      applyPlaylistAlignment(nextTracks);
      if (lines.length === 0) setError('所选歌曲没有可用歌词');
    } catch (cause) {
      if (requestId !== lyricRequestId.current) return;
      const nextTracks = loadingTracks.map((item, index) => index === trackIndex
        ? { ...item, status: 'error' as const, error: cause instanceof Error ? cause.message : '歌词获取失败' }
        : item);
      setPlaylistTracks(nextTracks);
      applyPlaylistAlignment(nextTracks);
      setError(cause instanceof Error ? cause.message : '歌词获取失败');
    } finally {
      if (requestId === lyricRequestId.current) setIsMatchingPlaylist(false);
    }
  }

  function changeMatchingAlgorithm(algorithm: MatchingAlgorithm) {
    matchingSettings.current = { ...matchingSettings.current, algorithm };
    setMatchingAlgorithm(algorithm);
    if (matchMode === 'playlist' && !isMatchingPlaylist) {
      applyPlaylistAlignment(playlistTracks);
    } else if (selectedSong && !isLoadingLyric) {
      setRows(alignSubtitles(entries, referenceLines, { algorithm, smartSegmentation }));
    }
  }

  function changeSmartSegmentation(enabled: boolean) {
    matchingSettings.current = { ...matchingSettings.current, smartSegmentation: enabled };
    setSmartSegmentation(enabled);
    if (matchMode === 'playlist' && !isMatchingPlaylist) {
      applyPlaylistAlignment(playlistTracks);
    } else if (selectedSong && !isLoadingLyric) {
      setRows(alignSubtitles(entries, referenceLines, { algorithm: matchingAlgorithm, smartSegmentation: enabled }));
    }
  }

  const updateRow = useCallback((id: string, patch: Partial<AlignmentRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }, []);

  const chooseRow = useCallback((row: AlignmentRow, choice: 'local' | 'reference') => {
    updateRow(row.id, { chosenText: choice === 'reference' ? row.referenceText : row.localText });
  }, [updateRow]);

  const copyReference = useCallback(async (row: AlignmentRow, lineText: string, lineIndex: number) => {
    if (!lineText) return;
    const lineKey = `${row.id}-${lineIndex}`;
    try {
      await copyText(lineText);
      setCopiedLineKey(lineKey);
      window.setTimeout(() => setCopiedLineKey((current) => current === lineKey ? null : current), 1_500);
    } catch {
      setError('无法写入剪贴板，请检查浏览器权限');
    }
  }, []);

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
    <main className="shell">
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
          <div className={`source-dropzone ${isDragging ? 'dragging' : ''}`} role="region" aria-label="SRT 文件导入区域">
            <div className="panel-heading">
              <div><p className="section-kicker">现场文本</p><h3>剪映识别结果</h3></div>
              <><button type="button" className="upload-button" onClick={() => sourceFileInputRef.current?.click()}>选择 SRT</button><input ref={sourceFileInputRef} className="source-file-input" type="file" tabIndex={-1} aria-hidden="true" accept=".srt,application/x-subrip" onChange={onFileChange} /></>
            </div>
            <p className="source-drop-hint">拖动 SRT 文件到这里，或选择文件导入</p>
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
          </> : <PlaylistMatchPanel initialValue={playlistDraftRef.current} isMatchingPlaylist={isMatchingPlaylist} playlistTracks={playlistTracks} onDraftChange={(value) => { playlistDraftRef.current = value; }} onSubmit={handlePlaylistSearch} onChooseSong={choosePlaylistSong} />}
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
        <div className="diff-header"><span>剪映现场版</span><span>网易云参考版</span><span>处理</span></div>
        <div className="diff-table">
          {(isLoadingLyric || isMatchingPlaylist) && <div className="loading-state">正在抓取歌词并按歌单顺序对齐…</div>}
          {!isLoadingLyric && !isMatchingPlaylist && rows.length === 0 && <div className="empty-review"><span className="empty-symbol">↔</span><strong>等待参考歌词</strong><p>{matchMode === 'playlist' ? '输入歌单后，工具会按顺序分段并保留现场独有内容。' : '先搜索并选择一首歌曲，工具会保留现场顺序，标出每处不同。'}</p></div>}
          {!isLoadingLyric && !isMatchingPlaylist && rows.map((row, index) => {
            const previousTrackIndex = index > 0 ? rows[index - 1].trackIndex : undefined;
            const showTrackHeading = matchMode === 'playlist' && row.trackIndex !== undefined && row.trackIndex !== previousTrackIndex;
            const track = row.trackIndex === undefined ? undefined : playlistTracks[row.trackIndex];
            return <ReviewRow key={row.id} row={row} index={index} showTrackHeading={showTrackHeading} track={track} copiedLineKey={copiedLineKey} onChooseRow={chooseRow} onUpdateRow={updateRow} onCopyReference={copyReference} />;
          })}
        </div>
      </section>

      <footer className="footer-note"><span>原始字幕不会被覆盖</span><span>·</span><span>网易云歌词仅作为参考</span><span>·</span><span>所有行按勾选结果导出</span></footer>
      {previewOpen && <div className="preview-overlay" onClick={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title"><div className="preview-heading"><div><h3 id="preview-title">导出预览</h3><span>{exportKind.toUpperCase()}</span></div><button ref={previewCloseRef} type="button" onClick={() => setPreviewOpen(false)} aria-label="关闭预览">关闭</button></div>{previewText.trim() ? <pre className="preview-content">{previewText}</pre> : <p className="preview-empty">没有可导出的字幕</p>}</section></div>}
    </main>
  );
}

export default App;
