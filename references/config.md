# 渲染配置

## 完整示例

```json
{
  "slug": "ai-entry-01",
  "text": "这里是经过筛选和必要排版后的正文。\n\n支持保留自然段。",
  "date": "2026-09-18",
  "sourceUrl": "https://x.com/example/status/123",
  "profile": {
    "name": "示例作者",
    "handle": "example",
    "avatar": "/绝对路径/avatar.jpg",
    "verified": true
  },
  "canvas": {
    "mode": "poster"
  },
  "card": {
    "theme": "dark",
    "scale": 92,
    "opacity": 100,
    "x": -20,
    "y": -37
  },
  "background": {
    "preset": "luxury-cigar-lounge"
  },
  "metrics": {
    "preset": "high",
    "likes": 328000,
    "views": 12800000
  },
  "live": {
    "duration": 3,
    "fps": 30
  }
}
```

顶层也可以是配置数组，渲染器会批量输出。

## 字段

### 基础

- `slug`：输出文件名，不含扩展名；必填且批量内唯一。
- `text`：卡片正文；必填。
- `date`：显示日期，`YYYY-MM-DD`；默认当天。
- `sourceUrl`：来源记录，只写入清单，不显示在卡片上。

### profile

- `name`：昵称，默认“你的名字”。
- `handle`：不带 `@` 的用户名，默认 `yourname`。
- `avatar`：本地绝对/相对路径或 HTTPS URL；不填则用匿名头像。
- `verified`：是否显示认证徽章，默认 `true`。

### canvas

- `mode: "poster"`：1080×1440，默认。
- `mode: "tall"`：1080×1920。

### card

- `theme`：`dark` 或 `light`，默认 `dark`。
- `scale`：50–140，默认 92。渲染器仍会为超长正文自动适配。
- `opacity`：30–100，默认 100。
- `x`：水平偏移，默认 -20。
- `y`：垂直偏移，默认 -37。

### background

只设置一种来源：

- `preset`：`luxury-wine-cellar`、`luxury-cigar-lounge`、`luxury-sports-car`、`luxury-golf-club`、`luxury-penthouse`。
- `path`：本地图片路径。
- `url`：HTTP/HTTPS 图片地址，渲染前会下载到本地临时内存。

### metrics

- `preset: "high"`：点赞和收藏为万级，转发与回复为千级，浏览量为几十万到数百万。
- `preset: "viral"`：更高一档的展示数据。
- `preset: "off"`：隐藏整行数据。
- `replies`、`reposts`、`likes`、`bookmarks`、`views`：非负整数；精确值覆盖预设。
- `source: "real" | "display"`：可显式声明。精确数值默认 `real`，使用预设默认 `display`。

### live

- `duration`：1–8 秒，默认 3。
- `fps`：24、25、30 或 60，默认 30。

## 命令行

```bash
node scripts/render.mjs --config /path/cards.json --output /path/output
```

可选参数：

- `--only both`：默认，同时输出 PNG 和 MP4。
- `--only png`：只输出 PNG。
- `--only live`：只输出 MP4。
- `--chrome /path/to/chrome`：覆盖自动检测到的 Chrome/Chromium 路径。

渲染器在输出目录生成 `render-manifest.json`，记录每条内容的来源、尺寸、文件、指标值及指标来源。
