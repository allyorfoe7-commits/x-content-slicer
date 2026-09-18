const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

const ICONS = {
  replies: '<svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg>',
  reposts: '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93L18.5 8c0-1.1-.896-2-2-2z"/></svg>',
  likes: '<svg viewBox="0 0 24 24"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg>',
  bookmarks: '<svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"/></svg>',
  views: '<svg viewBox="0 0 24 24"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"/></svg>',
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function fmtNum(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}万`;
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n || 0);
}

function fmtDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return iso || "";
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function richText(text) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, (m) => `<span class="link">${m}</span>`)
    .replace(/(^|[^\w@/])@([A-Za-z0-9_]{2,15})/g, '$1<span class="link">@$2</span>')
    .replace(/(^|[^&\w])#([\p{L}\p{N}_]+)/gu, '$1<span class="link">#$2</span>');
}

function waitImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error(`图片加载失败：${image.src}`)), { once: true });
  });
}

const state = {
  mode: q.get("mode") === "tall" ? "tall" : "poster",
  width: 1080,
  height: q.get("mode") === "tall" ? 1920 : 1440,
  scale: clamp(q.get("scale"), 50, 140, 92),
  opacity: clamp(q.get("opacity"), 30, 100, 100),
  x: clamp(q.get("x"), -400, 400, -20),
  y: clamp(q.get("y"), -700, 700, -37),
  fitScale: 1,
  fps: [24, 25, 30, 60].includes(Number(q.get("fps"))) ? Number(q.get("fps")) : 30,
  duration: clamp(q.get("duration"), 1, 8, 3),
};

function applyCardTransform() {
  const scale = state.fitScale * state.scale / 100;
  $("card").style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${scale.toFixed(4)})`;
}

async function captureCardCanvas() {
  const card = $("card");
  const previous = card.style.cssText;
  card.style.position = "relative";
  card.style.left = "0";
  card.style.top = "0";
  card.style.transform = "none";
  try {
    return await htmlToImage.toCanvas(card, { pixelRatio: 2, cacheBust: false });
  } finally {
    card.style.cssText = previous;
  }
}

function drawCover(ctx, image, width, height, zoom = 1) {
  const ratio = width / height;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  let drawWidth;
  let drawHeight;
  if (imageRatio > ratio) {
    drawHeight = height * zoom;
    drawWidth = drawHeight * imageRatio;
  } else {
    drawWidth = width * zoom;
    drawHeight = drawWidth / imageRatio;
  }
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

async function composePoster(progress = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = state.width;
  canvas.height = state.height;
  const ctx = canvas.getContext("2d");
  drawCover(ctx, $("background"), state.width, state.height, 1 + progress * 0.07);

  const card = $("card");
  const cardCanvas = await captureCardCanvas();
  const scale = state.fitScale * state.scale / 100;
  const width = card.offsetWidth * 2 * scale;
  const height = card.offsetHeight * 2 * scale;
  const x = state.width / 2 + state.x * 2;
  const y = state.height / 2 + state.y * 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.38)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(cardCanvas, x - width / 2, y - height / 2, width, height);
  ctx.restore();
  return canvas;
}

async function createLiveBlob() {
  if (!("VideoEncoder" in window)) throw new Error("当前 Chrome 不支持 WebCodecs VideoEncoder");

  const total = Math.round(state.fps * state.duration);
  const codec = {
    codec: "avc1.640028",
    width: state.width,
    height: state.height,
    bitrate: state.mode === "tall" ? 10_000_000 : 8_000_000,
    framerate: state.fps,
  };
  const support = await VideoEncoder.isConfigSupported(codec);
  if (!support.supported) throw new Error("当前设备不支持所需的 H.264 编码配置");

  const card = $("card");
  const cardCanvas = await captureCardCanvas();
  const scale = state.fitScale * state.scale / 100;
  const cardWidth = card.offsetWidth * 2 * scale;
  const cardHeight = card.offsetHeight * 2 * scale;
  const cardX = state.width / 2 + state.x * 2;
  const cardY = state.height / 2 + state.y * 2;

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: state.width, height: state.height },
    fastStart: "in-memory",
  });
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { encoderError = error; },
  });
  encoder.configure(codec);

  const canvas = document.createElement("canvas");
  canvas.width = state.width;
  canvas.height = state.height;
  const ctx = canvas.getContext("2d");

  for (let frameIndex = 0; frameIndex < total; frameIndex += 1) {
    const progress = total === 1 ? 0 : frameIndex / (total - 1);
    drawCover(ctx, $("background"), state.width, state.height, 1 + progress * 0.07);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.38)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(cardCanvas, cardX - cardWidth / 2, cardY - cardHeight / 2, cardWidth, cardHeight);
    ctx.restore();

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(frameIndex * 1_000_000 / state.fps),
      duration: Math.round(1_000_000 / state.fps),
    });
    encoder.encode(frame, { keyFrame: frameIndex % state.fps === 0 });
    frame.close();
    if (frameIndex % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

window.renderPng = async () => (await composePoster()).toDataURL("image/png");
window.downloadLive = async (filename) => {
  const blob = await createLiveBlob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

async function init() {
  const stage = $("stage");
  stage.style.height = `${state.height / 2}px`;

  const theme = q.get("theme") === "light" ? "light" : "dark";
  const card = $("card");
  card.classList.toggle("dark", theme === "dark");
  const alpha = state.opacity / 100;
  card.style.backgroundColor = theme === "dark" ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;

  $("name").textContent = q.get("name") || "你的名字";
  $("handle").textContent = `@${(q.get("handle") || "yourname").replace(/^@+/, "")}`;
  $("date").textContent = fmtDate(q.get("date"));
  $("badge").style.display = q.get("verified") === "0" ? "none" : "";

  const text = q.get("text") || "写点什么……";
  const body = $("body");
  body.innerHTML = richText(text);
  body.classList.toggle("size-m", text.length > 170 && text.length <= 320);
  body.classList.toggle("size-s", text.length > 320 && text.length <= 520);
  body.classList.toggle("size-xs", text.length > 520);

  const metricValues = Object.fromEntries(
    ["replies", "reposts", "likes", "bookmarks", "views"].map((key) => [key, Math.max(0, Math.round(Number(q.get(key)) || 0))]),
  );
  const metrics = $("metrics");
  if (q.get("metrics") === "off") {
    metrics.classList.add("hidden");
  } else {
    metrics.innerHTML = Object.keys(metricValues)
      .map((key) => `<span>${ICONS[key]}<b>${fmtNum(metricValues[key])}</b></span>`)
      .join("");
  }

  $("avatar").src = q.get("avatar") || "avatar.svg";
  const bg = q.get("bg") || "luxury-cigar-lounge";
  $("background").src = /^https?:\/\//i.test(bg) ? bg : `backgrounds/${bg}.png`;

  await Promise.all([waitImage($("avatar")), waitImage($("background")), document.fonts.ready]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  state.fitScale = Math.min(1, stage.clientHeight * 0.9 / card.offsetHeight, stage.clientWidth * 0.94 / card.offsetWidth);
  applyCardTransform();
  document.documentElement.dataset.ready = "1";
  window.__renderInfo = { width: state.width, height: state.height, fps: state.fps, duration: state.duration };
}

init().catch((error) => {
  window.__renderError = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.ready = "error";
});
