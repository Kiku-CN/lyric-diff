# Lyric CoCorrect

剪映演唱会字幕的歌词校对工作台。支持粘贴文本、上传 `.txt` / `.srt`，联网搜索网易云歌词，使用类似 `git diff` 的左右视图逐句确认并导出新字幕。

## 启动

```bash
pnpm install
pnpm dev
```

打开终端输出的本地地址即可使用。网易云请求通过 Vite 的 `/api/netease` 代理转发，优先使用网易云官网接口，并自动尝试公开备用节点；如果需要自托管 API，可设置 `NETEASE_API_BASE_URL`。

## 验证

```bash
pnpm test -- --run
pnpm exec tsc --noEmit
```

校对视图保留所有未匹配的网易云歌词。中间的参考新增行默认勾选导出，首尾默认不勾选；TXT 和 SRT 都按勾选状态导出。SRT 会为中间新增行分配时间，首尾手动勾选的行按最近原字幕时长推算；必要时允许重叠，但不修改原字幕时间。没有原始时间轴时，勾选的新增行只进入 TXT。
