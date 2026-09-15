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

SRT 导出只会更新已有现场时间轴行。网易云参考歌词新增的行没有可靠时间轴，因此默认不会写入 SRT。
