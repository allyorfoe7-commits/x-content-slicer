#!/usr/bin/env node

import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const studioDir = path.join(skillDir, "assets", "studio");
const metricKeys = ["replies", "reposts", "likes", "bookmarks", "views"];
const presets = new Set([
  "luxury-wine-cellar",
  "luxury-cigar-lounge",
  "luxury-sports-car",
  "luxury-golf-club",
  "luxury-penthouse",
]);

function usage() {
  return `用法：
  node scripts/render.mjs --config /path/cards.json --output /path/output

参数：
  --only both|png|live   输出格式，默认 both
  --chrome /path        指定 Chrome/Chromium
  --help                显示帮助`;
}

function parseArgs(argv) {
  const result = { only: "both" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--config") result.config = argv[++i];
    else if (arg === "--output") result.output = argv[++i];
    else if (arg === "--only") result.only = argv[++i];
    else if (arg === "--chrome") result.chrome = argv[++i];
    else throw new Error(`未知参数：${arg}`);
  }
  if (!["both", "png", "live"].includes(result.only)) throw new Error("--only 只能是 both、png 或 live");
  return result;
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function safeSlug(value, index) {
  const slug = String(value || `card-${String(index + 1).padStart(2, "0")}`)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!slug) throw new Error(`第 ${index + 1} 条的 slug 无效`);
  return slug;
}

function seededRandom(seedText) {
  let hash = 2166136261;
  for (const char of seedText) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function range(random, min, max, step = 1) {
  return Math.round((min + random() * (max - min)) / step) * step;
}

function normalizeMetrics(raw, slug) {
  if (raw?.preset === "off") return { enabled: false, source: raw.source || "display", values: {} };
  const preset = raw?.preset === "viral" ? "viral" : "high";
  const random = seededRandom(slug);
  const values = preset === "viral"
    ? {
        replies: range(random, 8000, 42000, 100),
        reposts: range(random, 35000, 180000, 1000),
        likes: range(random, 180000, 900000, 1000),
        bookmarks: range(random, 120000, 650000, 1000),
        views: range(random, 3_500_000, 22_000_000, 10_000),
      }
    : {
        replies: range(random, 1200, 8900, 100),
        reposts: range(random, 6500, 49000, 100),
        likes: range(random, 32000, 180000, 1000),
        bookmarks: range(random, 18000, 120000, 1000),
        views: range(random, 480000, 3_900_000, 10_000),
      };

  let exactCount = 0;
  for (const key of metricKeys) {
    if (raw && raw[key] != null) {
      const n = Number(raw[key]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${slug}: metrics.${key} 必须是非负数字`);
      values[key] = Math.round(n);
      exactCount += 1;
    }
  }
  const inferredSource = exactCount === metricKeys.length && !raw?.preset ? "real" : "display";
  return { enabled: true, source: raw?.source || inferredSource, values };
}

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function normalizeCard(raw, index, configDir) {
  if (!raw || typeof raw !== "object") throw new Error(`第 ${index + 1} 条配置必须是对象`);
  if (typeof raw.text !== "string" || !raw.text.trim()) throw new Error(`第 ${index + 1} 条缺少 text`);
  const slug = safeSlug(raw.slug, index);
  const mode = raw.canvas?.mode === "tall" ? "tall" : "poster";
  const theme = raw.card?.theme === "light" ? "light" : "dark";
  const background = raw.background || {};
  let backgroundSpec;
  if (background.path) backgroundSpec = { type: "path", value: path.resolve(configDir, background.path) };
  else if (background.url) backgroundSpec = { type: "url", value: background.url };
  else {
    const preset = background.preset || "luxury-cigar-lounge";
    if (!presets.has(preset)) throw new Error(`${slug}: 未知背景预设 ${preset}`);
    backgroundSpec = { type: "preset", value: preset };
  }

  let avatarSpec = null;
  if (raw.profile?.avatar) {
    const value = String(raw.profile.avatar);
    avatarSpec = /^https?:\/\//i.test(value)
      ? { type: "url", value }
      : { type: "path", value: path.resolve(configDir, value) };
  }

  return {
    slug,
    text: raw.text.trim(),
    date: raw.date || today(),
    sourceUrl: raw.sourceUrl || "",
    profile: {
      name: raw.profile?.name || "你的名字",
      handle: String(raw.profile?.handle || "yourname").replace(/^@+/, ""),
      verified: raw.profile?.verified !== false,
      avatarSpec,
    },
    canvas: {
      mode,
      width: 1080,
      height: mode === "tall" ? 1920 : 1440,
    },
    card: {
      theme,
      scale: clamp(raw.card?.scale, 50, 140, 92),
      opacity: clamp(raw.card?.opacity, 30, 100, 100),
      x: clamp(raw.card?.x, -400, 400, -20),
      y: clamp(raw.card?.y, -700, 700, -37),
    },
    backgroundSpec,
    metrics: normalizeMetrics(raw.metrics, slug),
    live: {
      duration: clamp(raw.live?.duration, 1, 8, 3),
      fps: [24, 25, 30, 60].includes(Number(raw.live?.fps)) ? Number(raw.live.fps) : 30,
    },
  };
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  }[ext] || "application/octet-stream";
}

async function makeAsset(spec, dynamicAssets, baseUrl) {
  if (!spec) return null;
  let buffer;
  let mime;
  if (spec.type === "path") {
    buffer = await readFile(spec.value);
    mime = mimeFromPath(spec.value);
  } else if (spec.type === "url") {
    const response = await fetch(spec.value, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`下载图片失败 ${response.status}: ${spec.value}`);
    buffer = Buffer.from(await response.arrayBuffer());
    mime = response.headers.get("content-type")?.split(";")[0] || mimeFromPath(new URL(spec.value).pathname);
  } else {
    return spec.value;
  }
  if (!mime.startsWith("image/")) throw new Error(`不是可识别的图片：${spec.value}`);
  if (buffer.length > 25 * 1024 * 1024) throw new Error(`图片超过 25MB：${spec.value}`);
  const token = randomUUID();
  dynamicAssets.set(`/__asset/${token}`, { buffer, mime });
  return `${baseUrl}/__asset/${token}`;
}

async function createServer(dynamicAssets) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const dynamic = dynamicAssets.get(url.pathname);
      if (dynamic) {
        response.writeHead(200, { "Content-Type": dynamic.mime, "Cache-Control": "no-store" });
        response.end(dynamic.buffer);
        return;
      }
      const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const target = path.resolve(studioDir, `.${pathname}`);
      if (target !== studioDir && !target.startsWith(`${studioDir}${path.sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const content = await readFile(target);
      response.writeHead(200, { "Content-Type": mimeFromPath(target), "Cache-Control": "no-store" });
      response.end(content);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

async function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* 继续 */ }
  }
  return null;
}

function buildQuery(card, background, avatar) {
  const query = new URLSearchParams({
    text: card.text,
    date: card.date,
    name: card.profile.name,
    handle: card.profile.handle,
    verified: card.profile.verified ? "1" : "0",
    mode: card.canvas.mode,
    theme: card.card.theme,
    scale: String(card.card.scale),
    opacity: String(card.card.opacity),
    x: String(card.card.x),
    y: String(card.card.y),
    bg: background,
    duration: String(card.live.duration),
    fps: String(card.live.fps),
  });
  if (avatar) query.set("avatar", avatar);
  if (!card.metrics.enabled) query.set("metrics", "off");
  else for (const key of metricKeys) query.set(key, String(card.metrics.values[key]));
  return query;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.config) throw new Error(`缺少 --config\n\n${usage()}`);
  const configPath = path.resolve(args.config);
  const configDir = path.dirname(configPath);
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  const rawCards = Array.isArray(raw) ? raw : Array.isArray(raw.cards) ? raw.cards : [raw];
  if (!rawCards.length) throw new Error("配置中没有卡片");
  const cards = rawCards.map((card, index) => normalizeCard(card, index, configDir));
  const unique = new Set(cards.map((card) => card.slug));
  if (unique.size !== cards.length) throw new Error("批量配置中的 slug 必须唯一");

  const outputDir = path.resolve(args.output || path.join(configDir, "output"));
  await mkdir(outputDir, { recursive: true });

  const dynamicAssets = new Map();
  const server = await createServer(dynamicAssets);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const chrome = await findChrome(args.chrome);
  let browser;
  const results = [];

  try {
    browser = await chromium.launch({
      headless: true,
      ...(chrome ? { executablePath: chrome } : {}),
      args: ["--enable-features=WebCodecs"],
    });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1080, height: 1920 } });
    const page = await context.newPage();

    for (const card of cards) {
      const result = {
        slug: card.slug,
        sourceUrl: card.sourceUrl,
        canvas: card.canvas,
        metrics: card.metrics.values,
        metricsSource: card.metrics.source,
        files: {},
      };
      try {
        const background = await makeAsset(card.backgroundSpec, dynamicAssets, baseUrl);
        const avatar = await makeAsset(card.profile.avatarSpec, dynamicAssets, baseUrl);
        const query = buildQuery(card, background, avatar);
        await page.goto(`${baseUrl}/?${query}`, { waitUntil: "networkidle", timeout: 30_000 });
        await page.waitForFunction(() => ["1", "error"].includes(document.documentElement.dataset.ready), null, { timeout: 30_000 });
        const state = await page.evaluate(() => ({ ready: document.documentElement.dataset.ready, error: window.__renderError, info: window.__renderInfo }));
        if (state.ready !== "1") throw new Error(state.error || "页面渲染失败");

        if (args.only !== "live") {
          const dataUrl = await page.evaluate(() => window.renderPng());
          const pngPath = path.join(outputDir, `${card.slug}.png`);
          await writeFile(pngPath, Buffer.from(dataUrl.split(",")[1], "base64"));
          result.files.png = pngPath;
        }

        if (args.only !== "png") {
          const filename = `${card.slug}.mp4`;
          const downloadPromise = page.waitForEvent("download", { timeout: 240_000 });
          await page.evaluate((name) => window.downloadLive(name), filename);
          const download = await downloadPromise;
          const mp4Path = path.join(outputDir, filename);
          await download.saveAs(mp4Path);
          result.files.live = mp4Path;
          result.live = { duration: card.live.duration, fps: card.live.fps, codec: "H.264" };
        }
        result.status = "ok";
        console.log(`✓ ${card.slug}`);
      } catch (error) {
        result.status = "error";
        result.error = error instanceof Error ? error.message : String(error);
        console.error(`✗ ${card.slug}: ${result.error}`);
      }
      results.push(result);
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const manifestPath = path.join(outputDir, "render-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), host: os.platform(), results }, null, 2)}\n`);
  console.log(`清单：${manifestPath}`);
  if (results.some((result) => result.status !== "ok")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
