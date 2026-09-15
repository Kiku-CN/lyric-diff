import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { alignSubtitles, type AlignmentRow } from './lib/alignment';
import { exportSrt, exportTxt, parseSubtitle, type SubtitleEntry } from './lib/subtitles';
import { fetchNeteaseLyric, searchNetease, stripLyricTimestamps, type NeteaseSong } from './server/netease';

type InputKind = 'srt' | 'txt';

const starterText = `把酒倒满\n朋友一生一起走\n那些日子不再有`;

function App() {
  const [inputKind, setInputKind] = useState<InputKind>('txt');
  const [sourceText, setSourceText] = useState(starterText);
  const [fileName, setFileName] = useState('未命名现场歌词.txt');
  const [entries, setEntries] = useState<SubtitleEntry[]>(() => parseSubtitle(starterText, 'txt'));
  const [playlist, setPlaylist] = useState('');
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<NeteaseSong[]>([]);
  const [selectedSong, setSelectedSong] = useState<NeteaseSong | null>(null);
  const [rows, setRows] = useState<AlignmentRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingLyric, setIsLoadingLyric] = useState(false);
  const [error, setError] = useState('');
  const [exportKind, setExportKind] = useState<InputKind>('srt');

  const hasTimeline = entries.some((entry) => entry.startMs !== undefined);
  const diffStats = useMemo(() => rows.reduce((stats, row) => {
    stats[row.kind] += 1;
    return stats;
  }, { equal: 0, change: 0, add: 0, remove: 0 } as Record<AlignmentRow['kind'], number>), [rows]);

  function applySourceText(text: string, kind: InputKind, name = fileName) {
    setSourceText(text);
    setInputKind(kind);
    setFileName(name);
    setRows([]);
    try {
      setEntries(parseSubtitle(text, kind));
      setError('');
    } catch (cause) {
      setEntries([]);
      setError(cause instanceof Error ? cause.message : '无法解析字幕');
    }
  }

  function changeInputKind(kind: InputKind) {
    applySourceText(sourceText, kind);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.toLowerCase().endsWith('.srt') ? 'srt' : 'txt';
    applySourceText(await file.text(), extension, file.name);
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const fallback = entries[0]?.text ?? '';
    const nextQuery = query.trim() || playlist.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || fallback;
    setQuery(nextQuery);
    setIsSearching(true);
    setError('');
    try {
      setSongs(await searchNetease(nextQuery));
    } catch (cause) {
      setSongs([]);
      setError(cause instanceof Error ? cause.message : '搜索失败');
    } finally {
      setIsSearching(false);
    }
  }

  async function chooseSong(song: NeteaseSong) {
    setSelectedSong(song);
    setIsLoadingLyric(true);
    setError('');
    try {
      const lyric = await fetchNeteaseLyric(song.id);
      setRows(alignSubtitles(entries, stripLyricTimestamps(lyric)));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : '歌词获取失败');
    } finally {
      setIsLoadingLyric(false);
    }
  }

  function updateRow(id: string, patch: Partial<AlignmentRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function chooseRow(row: AlignmentRow, choice: 'local' | 'reference') {
    updateRow(row.id, { chosenText: choice === 'reference' ? row.referenceText : row.localText });
  }

  function download() {
    const chosenById = new Map(rows.filter((row) => row.localIds.length === 1).flatMap((row) => row.localIds.map((id) => [id, row.chosenText] as const)));
    const output = entries.map((entry) => ({ ...entry, text: chosenById.get(entry.id) ?? entry.text }));
    const body = exportKind === 'srt' ? exportSrt(output) : exportTxt(output);
    const blob = new Blob([body], { type: exportKind === 'srt' ? 'text/plain;charset=utf-8' : 'text/plain;charset=utf-8' });
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
        <div className="panel source-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">现场文本</p><h3>剪映识别结果</h3></div>
            <label className="upload-button">上传文件<input type="file" accept=".srt,.txt,text/plain" onChange={onFileChange} /></label>
          </div>
          <div className="segmented" role="tablist" aria-label="输入格式">
            <button className={inputKind === 'txt' ? 'selected' : ''} onClick={() => changeInputKind('txt')}>TXT / 粘贴</button>
            <button className={inputKind === 'srt' ? 'selected' : ''} onClick={() => changeInputKind('srt')}>SRT 时间轴</button>
          </div>
          <textarea value={sourceText} onChange={(event) => applySourceText(event.target.value, inputKind)} aria-label="现场歌词文本" />
          <div className="panel-foot"><span>{entries.length} 行已解析</span><span>{hasTimeline ? '时间轴已保留' : '纯文本模式'}</span></div>
        </div>

        <div className="panel match-panel">
          <div className="panel-heading"><div><p className="section-kicker">参考来源</p><h3>网易云歌词</h3></div><span className="service-pill">联网搜索</span></div>
          <form className="search-form" onSubmit={handleSearch}>
            <label htmlFor="song-query">歌名 / 歌手 / 歌词片段</label>
            <div className="search-row"><input id="song-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：歌名 - 歌手" /><button type="submit" disabled={isSearching}>{isSearching ? '搜索中…' : '搜索'}</button></div>
          </form>
          <label className="field-label" htmlFor="playlist">演唱会歌单（可选，一行一首）</label>
          <textarea id="playlist" className="playlist-input" value={playlist} onChange={(event) => setPlaylist(event.target.value)} placeholder="有歌单时优先按歌单匹配\n没有歌单也可以直接搜索" />
          <div className="candidate-list">
            {songs.length === 0 && <p className="empty-note">搜索结果会显示在这里。没有网络时仍可先整理现场文本。</p>}
            {songs.map((song) => <button className={`candidate ${selectedSong?.id === song.id ? 'chosen' : ''}`} key={song.id} onClick={() => chooseSong(song)}><span><strong>{song.name}</strong><small>{song.artists} · {song.album}</small></span><span aria-hidden="true">{selectedSong?.id === song.id ? '✓' : '→'}</span></button>)}
          </div>
        </div>
      </section>

      {error && <div className="notice error" role="alert"><strong>需要注意</strong><span>{error}</span><button onClick={() => setError('')} aria-label="关闭提示">×</button></div>}

      <section className="review-section">
        <div className="review-heading"><div><p className="section-kicker">02 / REVIEW</p><h2>逐句对照</h2><p>{selectedSong ? `${selectedSong.name} · ${selectedSong.artists}` : '选择一首参考歌曲后开始对齐'}</p></div><div className="review-actions"><div className="stats"><span><b>{diffStats.change}</b> 差异</span><span><b>{diffStats.add}</b> 参考新增</span><span><b>{diffStats.remove}</b> 现场独有</span></div><select value={exportKind} onChange={(event) => setExportKind(event.target.value as InputKind)} aria-label="导出格式"><option value="srt">导出 SRT</option><option value="txt">导出 TXT</option></select><button className="primary-action" onClick={download} disabled={!entries.length}>下载校对稿 ↓</button></div></div>
        <div className="diff-header"><span>剪映现场版</span><span>网易云参考版</span><span>处理</span></div>
        <div className="diff-table">
          {isLoadingLyric && <div className="loading-state">正在抓取歌词并按顺序对齐…</div>}
          {!isLoadingLyric && rows.length === 0 && <div className="empty-review"><span className="empty-symbol">↔</span><strong>等待参考歌词</strong><p>先搜索并选择一首歌曲，工具会保留现场顺序，标出每处不同。</p></div>}
          {!isLoadingLyric && rows.map((row, index) => <div className={`diff-row ${row.kind}`} key={row.id}><div className="line-number">{String(index + 1).padStart(2, '0')}</div><div className="diff-cell local"><span>{row.localText || '—'}</span></div><div className="diff-cell reference"><span>{row.referenceText || '—'}</span></div><div className="row-controls"><button onClick={() => chooseRow(row, 'local')} className={row.chosenText === row.localText ? 'active' : ''}>现场</button><button onClick={() => chooseRow(row, 'reference')} className={row.chosenText === row.referenceText && Boolean(row.referenceText) ? 'active reference-choice' : ''} disabled={!row.referenceText || row.localIds.length !== 1} title={row.localIds.length > 1 ? '多个 SRT 条目合并显示，参考文本仅用于对比' : undefined}>参考</button><input aria-label={`编辑第 ${index + 1} 行`} value={row.chosenText} disabled={row.localIds.length > 1} onChange={(event) => updateRow(row.id, { chosenText: event.target.value })} /></div></div>)}
        </div>
      </section>

      <footer className="footer-note"><span>原始字幕不会被覆盖</span><span>·</span><span>网易云歌词仅作为参考</span><span>·</span><span>新增参考行默认不写入 SRT 时间轴</span></footer>
    </main>
  );
}

export default App;
