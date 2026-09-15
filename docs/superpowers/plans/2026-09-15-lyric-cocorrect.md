# Lyric CoCorrect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 搭建一个可运行的歌词校对工作台，支持剪映 `.srt` / `.txt` / 粘贴文本输入、网易云候选歌词和 git diff 风格的逐行选择导出。

**Architecture:** React + TypeScript + Vite 前端；字幕解析、对齐和导出保持为独立纯函数；网易云请求通过本地服务代理，前端在无网络或接口失败时仍可完成本地校对和导出。

**Tech Stack:** Vite, React, TypeScript, Vitest, CSS.

**Spec:** `docs/superpowers/specs/2026-09-15-lyric-cocorrect-design.md`

## Global Constraints

- 保留原始现场识别文本和 SRT 时间轴，不原地覆盖输入文件。
- 参考歌词新增行默认没有时间轴，不写入导出的 SRT。
- 只改动与本工具相关的文件；不执行全量生产构建。
- UI 文案使用简体中文，代码和专有名词保持英文。

---

### Task 1: 项目脚手架与可测试脚本

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/vite-env.d.ts`
- Create: `tests/setup.ts`

**Interfaces:**
- Produces npm scripts `dev`, `check`, `test` and React entrypoint.

- [ ] 建立 Vite/React 依赖和脚本。
- [ ] 配置 Vitest 使用 jsdom，并运行一个最小 smoke test。
- [ ] 运行 `npm test -- --run`，确认测试命令可执行。

### Task 2: 字幕解析、导出与对齐核心

**Files:**
- Create: `src/lib/subtitles.ts`, `src/lib/alignment.ts`
- Create: `tests/subtitles.test.ts`, `tests/alignment.test.ts`

**Interfaces:**
- `parseSubtitle(input: string, extension: 'srt' | 'txt'): SubtitleEntry[]`
- `exportSrt(entries: SubtitleEntry[]): string`
- `exportTxt(entries: SubtitleEntry[]): string`
- `alignSubtitles(local: SubtitleEntry[], referenceLines: string[]): AlignmentRow[]`

- [ ] 先写 SRT、TXT、时间轴往返和重复/插入/删除的失败测试并确认失败。
- [ ] 实现最小解析、导出和动态规划对齐。
- [ ] 运行 `npm test -- --run tests/subtitles.test.ts tests/alignment.test.ts`。

### Task 3: 网易云服务适配器

**Files:**
- Create: `src/server/netease.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- `searchNetease(query: string): Promise<NeteaseSong[]>`
- `fetchNeteaseLyric(songId: number): Promise<string>`

- [ ] 添加 `/api/netease/search` 和 `/api/netease/lyric` 的开发代理处理。
- [ ] 统一网络错误为可展示的 `NeteaseError`，不让页面崩溃。

### Task 4: 输入与校对工作台 UI

**Files:**
- Create: `src/App.tsx`, `src/styles.css`
- Modify: `src/main.tsx`, `index.html`

**Interfaces:**
- 页面状态包括输入源、歌单、搜索候选、对齐行、导出格式和错误状态。
- 文件上传通过 `File.text()` 调用 `parseSubtitle`；选择按钮更新 `AlignmentRow.chosenText`。

- [ ] 实现粘贴、文件上传、歌单输入和解析摘要。
- [ ] 实现网易云搜索、候选选择和歌词加载错误态。
- [ ] 实现左右 diff 行、保留现场/采用参考/手动编辑。
- [ ] 实现 SRT/TXT 下载，不覆盖原文件。
- [ ] 添加响应式样式、focus 状态和窄屏堆叠布局。

### Task 5: 验证

**Files:**
- Modify: `package.json` only if scripts need adjustment.

- [ ] 运行 `npm run check`。
- [ ] 运行 `npm run dev -- --host 127.0.0.1`，手动验证输入、diff 和导出。
- [ ] 检查 `git diff`，确认没有无关文件改动。
