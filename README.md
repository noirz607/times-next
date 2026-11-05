# 华东师大 · 旧闻缓递（重写版）

一站式聚合华东师范大学本科生院、书院与各学院的通知公告。

这是 [ECNU-minus/times](https://github.com/ECNU-minus/times) 的重写版本。旧版基于博客"友链朋友圈"程序 Friend-Circle-Lite 改造，本仓库去掉了该依赖：用一个约 200 行的 TypeScript 脚本替代原 Python 爬虫包，前端用 Vue 3 重写。

## 架构

```
各学院官网 ──► RSSHub 路由 (/ecnu/*) ──► scripts/fetch-notices.ts ──► public/notices.json ──► Vue 前端 ──► GitHub Pages
                 └─────────── 都在一次 GitHub Actions 运行中完成（每 4 小时）───────────┘
```

1. **RSSHub**：每个学院的通知页对应一条路由，负责把 HTML 页面转成 RSS XML。路由维护在 [ECNU-minus/RSSHub](https://github.com/ECNU-minus/RSSHub)，并已合并进官方仓库。
2. **抓取脚本** [`scripts/fetch-notices.ts`](scripts/fetch-notices.ts)：并发请求所有路由，解析 XML，清洗、去重、排序后输出 `notices.json`。
3. **前端**：纯静态页面，运行时加载 `notices.json`。
4. **Workflow** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：定时触发，用 `services` 启动一个临时的 RSSHub 容器，依次运行抓取脚本、构建前端，再通过官方的 Pages Action 部署。

### 与旧版的区别

| | 旧版 | 本仓库 |
|---|---|---|
| 来源配置 | `sites.json` + `conf.yaml` 两处 | 只有 [`src/data/sources.json`](src/data/sources.json) 一处 |
| 转换脚本 | Friend-Circle-Lite（Python，含邮件订阅、博客 RSS 自动探测等无关功能） | 单文件 TS 脚本，和前端共用类型定义 |
| 历史数据 | 每次运行只保留本次抓到的数据 | 与上次部署的数据合并，保留 180 天内的通知；某个来源抓取失败时保留它之前的数据 |
| 摘要 | 丢弃 | 保留纯文本摘要，可被搜索 |
| 空标题 | 显示为空白卡片 | 用正文开头兜底 |
| 部署 | 强制推送到 `page` 分支 | `actions/deploy-pages`，不污染 git 历史 |

### 前端功能

- 关键词搜索（标题、摘要、来源名称），按 `/` 快速聚焦，命中词高亮
- 按分类（教务综合 / 书院 / 理工 / 人文社科）或具体来源筛选，支持多选
- **我的关注**：给来源加星标，之后打开即只看自己关心的通知
- **收藏**：保存通知快照，原通知过期后仍可查看
- **已读 / 未读**：点击过的通知变灰；支持"只看未读"和"全部已读"
- 新抓取到的通知显示 NEW 标记；按日期分组；深色模式；移动端适配

所有个人数据只保存在浏览器的 `localStorage` 中。

## 本地开发

需要 Node.js ≥ 22.18（脚本依赖 Node 原生的 TypeScript 类型擦除）。

```bash
npm install
npm run dev          # 使用仓库自带的 public/notices.json 作为示例数据
```

如果要用真实数据，先在本地启动 RSSHub，再运行抓取脚本：

```bash
docker run -d -p 1200:1200 diygod/rsshub
npm run fetch        # 默认请求 http://localhost:1200
```

## 新增一个来源

1. 在 RSSHub 中为该页面编写路由（参考 `lib/routes/ecnu/` 下已有的路由）。
2. 在 [`src/data/sources.json`](src/data/sources.json) 中加一条记录，图标放进 `public/logos/<id>.webp`。图标只显示 18–56 px，请先压缩到 128×128 左右，几 KB 即可；原始大图会让切换页面明显卡顿。

## 部署

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
2. （推荐）在 Settings → Secrets and variables → Actions → Variables 中添加 `SITE_URL`，值为站点地址（如 `https://ecnu-minus.github.io/times-next`）。抓取脚本会读取上一次部署的 `notices.json` 来累积历史数据。
3. 如需自定义域名，在 `public/` 下添加 `CNAME` 文件。
