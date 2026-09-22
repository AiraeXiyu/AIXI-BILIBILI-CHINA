const BUNNY_BASE = "https://dlbunny.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
    },
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeVideo(item, index) {
  if (!item || typeof item !== "object") return null;

  const width = Number(item.width) || null;
  const height = Number(item.height) || null;

  return {
    index,

    url:
      item.url ??
      item.video_url ??
      item.play_addr ??
      item.download_url ??
      null,

    width,
    height,

    resolution:
      item.resolution ??
      (width && height ? `${width}x${height}` : null),

    format:
      item.ext ??
      item.format ??
      item.media_format ??
      "mp4",

    size:
      item.size ??
      item.file_size ??
      item.filesize ??
      null,

    attr: item.attr ?? null,
    donate_flag: item.donate_flag ?? null,

    raw: item,
  };
}

function extractVideos(data) {
  const candidates = [
    data?.video_play_addr,
    data?.data?.video_play_addr,
    data?.result?.video_play_addr,
    data?.info?.video_play_addr,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item, index) => normalizeVideo(item, index))
        .filter(Boolean);
    }

    if (candidate && typeof candidate === "object") {
      return Object.values(candidate)
        .map((item, index) => normalizeVideo(item, index))
        .filter(Boolean);
    }
  }

  return [];
}

async function resolve(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: "Body harus berupa JSON.",
      },
      400
    );
  }

  const {
    url,
    captcha_uuid,
    captcha_code,
    anonymous = true,
    format = "mp4",
  } = body;

  if (!url) {
    return json(
      {
        success: false,
        error: "URL BiliBili wajib diisi.",
      },
      400
    );
  }

  if (!captcha_uuid) {
    return json(
      {
        success: false,
        error: "captcha_uuid wajib diisi.",
      },
      400
    );
  }

  if (!captcha_code) {
    return json(
      {
        success: false,
        error: "captcha_code wajib diisi.",
      },
      400
    );
  }

  const payload = {
    user_uuid_text: String(captcha_uuid),
    user_input_text: String(url),
    user_select_media_format: String(format),
    user_select_appid: 3,
    user_select_app: "bilibili",
    user_input_captcha_text: String(captcha_code),
    user_anonymous: Boolean(anonymous),
  };

  let upstream;

  try {
    upstream = await fetch(`${BUNNY_BASE}/api/create_oxy_order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
        Origin: BUNNY_BASE,
        Referer: `${BUNNY_BASE}/id/bilibili`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "Gagal menghubungi BunnyDL.",
        detail: String(error?.message || error),
      },
      502
    );
  }

  const contentType = upstream.headers.get("content-type") || "";

  let data;

  try {
    if (contentType.includes("application/json")) {
      data = await upstream.json();
    } else {
      const text = await upstream.text();

      try {
        data = JSON.parse(text);
      } catch {
        data = {
          raw_response: text,
        };
      }
    }
  } catch {
    return json(
      {
        success: false,
        error: "Response BunnyDL tidak dapat dibaca.",
        upstream_status: upstream.status,
      },
      502
    );
  }

  const videos = extractVideos(data);

  return json({
    success: upstream.ok,
    upstream_status: upstream.status,

    message:
      data?.info ??
      data?.message ??
      data?.msg ??
      null,

    videos,

    upstream: data,
  });
}

function playground() {
  return html(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width,initial-scale=1,maximum-scale=1"
/>
<title>BunnyDL BiliBili REST API</title>

<style>
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: #f4f5f7;
  color: #111;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

body {
  min-height: 100vh;
}

.app {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 18px 14px 40px;
}

.header {
  margin-bottom: 18px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
}

.header p {
  margin: 7px 0 0;
  color: #666;
  font-size: 13px;
}

.card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 16px;
  padding: 15px;
  margin-bottom: 14px;
  box-shadow: 0 4px 14px rgba(0,0,0,.04);
}

label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 7px;
}

input,
select,
button {
  width: 100%;
  min-height: 46px;
  border-radius: 11px;
  font-size: 15px;
}

input,
select {
  border: 1px solid #ccc;
  padding: 0 12px;
  background: #fff;
  color: #111;
}

.field {
  margin-bottom: 14px;
}

.captcha-box {
  border: 1px dashed #aaa;
  border-radius: 12px;
  padding: 12px;
  text-align: center;
  margin-bottom: 12px;
  background: #fafafa;
}

#captchaImage {
  display: block;
  max-width: 100%;
  min-height: 70px;
  margin: 0 auto 10px;
  object-fit: contain;
}

button {
  border: 0;
  background: #111;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  padding: 0 16px;
}

button.secondary {
  background: #eee;
  color: #111;
  margin-top: 9px;
}

button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.status {
  font-size: 13px;
  margin-top: 10px;
  white-space: pre-wrap;
}

.hidden {
  display: none !important;
}

.result-title {
  font-weight: 800;
  margin-bottom: 10px;
}

.video-item {
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 12px;
  margin-top: 9px;
}

.video-info {
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.video-info strong {
  font-size: 15px;
}

.video-item button {
  margin-top: 9px;
  min-height: 42px;
  font-size: 14px;
}

pre {
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: #111;
  color: #eee;
  border-radius: 12px;
  padding: 12px;
  font-size: 11px;
  line-height: 1.5;
  max-height: 420px;
  overflow-y: auto;
}

.small {
  color: #777;
  font-size: 11px;
  line-height: 1.5;
}

.error {
  color: #b00020;
}

.success {
  color: #087a3d;
}
</style>
</head>

<body>
<div class="app">

  <div class="header">
    <h1>BunnyDL BiliBili API</h1>
    <p>Mobile-first REST API playground</p>
  </div>

  <div class="card">

    <div class="field">
      <label for="videoUrl">BiliBili URL</label>
      <input
        id="videoUrl"
        type="url"
        placeholder="https://www.bilibili.com/..."
        autocomplete="off"
      />
    </div>

    <div class="field">
      <label>CAPTCHA</label>

      <div class="captcha-box">
        <img id="captchaImage" alt="CAPTCHA" />
        <div class="small">
          Masukkan kode CAPTCHA secara manual.
        </div>
      </div>

      <button
        type="button"
        class="secondary"
        id="refreshCaptcha"
      >
        REFRESH CAPTCHA
      </button>
    </div>

    <div class="field">
      <label for="captchaUuid">CAPTCHA UUID</label>
      <input
        id="captchaUuid"
        type="text"
        placeholder="UUID CAPTCHA"
        autocomplete="off"
      />
    </div>

    <div class="field">
      <label for="captchaCode">CAPTCHA Code</label>
      <input
        id="captchaCode"
        type="text"
        maxlength="8"
        placeholder="Masukkan kode"
        autocomplete="off"
      />
    </div>

    <div class="field">
      <label for="format">Format</label>
      <select id="format">
        <option value="mp4">MP4</option>
        <option value="mp3">MP3</option>
        <option value="jpeg">JPEG</option>
      </select>
    </div>

    <button id="execute">
      EXECUTE
    </button>

    <div id="status" class="status"></div>

  </div>

  <div id="resultsCard" class="card hidden">

    <div class="result-title">
      AVAILABLE RESOLUTIONS
    </div>

    <div id="results"></div>

  </div>

  <div id="rawCard" class="card hidden">

    <div class="result-title">
      RESPONSE
    </div>

    <pre id="rawResponse"></pre>

  </div>

  <div class="small">
    CAPTCHA dan pembatas akses BunnyDL tetap berlaku.
    Tombol download hanya menggunakan URL yang dikembalikan oleh
    BunnyDL.
  </div>

</div>

<script>
const captchaImage = document.getElementById("captchaImage");
const captchaUuid = document.getElementById("captchaUuid");
const captchaCode = document.getElementById("captchaCode");
const refreshCaptcha = document.getElementById("refreshCaptcha");
const execute = document.getElementById("execute");
const statusBox = document.getElementById("status");
const resultsCard = document.getElementById("resultsCard");
const results = document.getElementById("results");
const rawCard = document.getElementById("rawCard");
const rawResponse = document.getElementById("rawResponse");

let currentCaptchaUrl = "";

function setStatus(message, type = "") {
  statusBox.className = "status " + type;
  statusBox.textContent = message;
}

function refreshCaptchaImage() {
  const rand = Math.floor(Math.random() * 1000000);

  currentCaptchaUrl =
    "/api/captcha-image?rand=" +
    rand;

  captchaImage.src = currentCaptchaUrl;

  /*
   * UUID CAPTCHA tidak selalu bisa diperoleh hanya dari
   * URL gambar. Karena itu UUID dapat diisi manual pada
   * field di bawah sesuai flow/session yang digunakan.
   */
}

refreshCaptcha.addEventListener("click", () => {
  refreshCaptchaImage();
  captchaCode.value = "";
  setStatus("CAPTCHA diperbarui.");
});

execute.addEventListener("click", async () => {
  const url =
    document.getElementById("videoUrl").value.trim();

  const uuid =
    captchaUuid.value.trim();

  const code =
    captchaCode.value.trim();

  const format =
    document.getElementById("format").value;

  if (!url) {
    setStatus("Masukkan URL BiliBili.", "error");
    return;
  }

  if (!uuid) {
    setStatus("Masukkan CAPTCHA UUID.", "error");
    return;
  }

  if (!code) {
    setStatus("Masukkan CAPTCHA Code.", "error");
    return;
  }

  execute.disabled = true;
  resultsCard.classList.add("hidden");
  rawCard.classList.add("hidden");
  results.innerHTML = "";

  setStatus("Memproses request...");

  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        captcha_uuid: uuid,
        captcha_code: code,
        anonymous: true,
        format
      })
    });

    const data = await response.json();

    rawCard.classList.remove("hidden");
    rawResponse.textContent =
      JSON.stringify(data, null, 2);

    if (!data.success) {
      setStatus(
        data.message ||
        data.error ||
        "Request gagal.",
        "error"
      );

      execute.disabled = false;
      return;
    }

    if (!Array.isArray(data.videos) ||
        data.videos.length === 0) {

      setStatus(
        "Request berhasil, tetapi BunnyDL tidak mengembalikan video yang bisa ditampilkan.",
        "error"
      );

      execute.disabled = false;
      return;
    }

    renderVideos(data.videos);

    setStatus(
      data.videos.length +
      " resolusi ditemukan.",
      "success"
    );

  } catch (error) {
    setStatus(
      "Error: " + error.message,
      "error"
    );
  }

  execute.disabled = false;
});

function renderVideos(videos) {
  results.innerHTML = "";

  videos.forEach((video, index) => {
    const item = document.createElement("div");
    item.className = "video-item";

    const title =
      video.resolution ||
      (
        video.width &&
        video.height
          ? video.width + "x" + video.height
          : "Unknown resolution"
      );

    const format =
      video.format || "unknown";

    const size =
      video.size || "unknown";

    const donate =
      video.donate_flag === null
        ? "unknown"
        : String(video.donate_flag);

    item.innerHTML = \`
      <div class="video-info">
        <strong>\${escapeHtml(title)}</strong><br>
        Format: \${escapeHtml(format)}<br>
        Size: \${escapeHtml(String(size))}<br>
        Donate flag: \${escapeHtml(donate)}
      </div>
    \`;

    if (video.url) {
      const button =
        document.createElement("button");

      button.textContent =
        "DOWNLOAD " + title;

      button.addEventListener("click", () => {
        downloadVideo(
          video.url,
          title,
          format
        );
      });

      item.appendChild(button);
    } else {
      const note =
        document.createElement("div");

      note.className = "small";
      note.style.marginTop = "8px";
      note.textContent =
        "URL download tidak diberikan pada response.";

      item.appendChild(note);
    }

    results.appendChild(item);
  });

  resultsCard.classList.remove("hidden");
}

function downloadVideo(url, resolution, format) {
  /*
   * Hanya membuka URL yang diberikan BunnyDL.
   * Tidak mengubah URL atau mencoba melewati
   * pembatas akses/resolusi.
   */

  const extension =
    format || "mp4";

  const filename =
    "bilibili-" +
    resolution.replace(/[^a-zA-Z0-9x_-]/g, "_") +
    "." +
    extension;

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  document.body.appendChild(link);
  link.click();
  link.remove();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refreshCaptchaImage();
</script>

</body>
</html>`);
}

async function handleCaptchaImage(request) {
  const incoming = new URL(request.url);

  const target =
    new URL("/api/get_captcha", BUNNY_BASE);

  for (const [key, value] of incoming.searchParams) {
    target.searchParams.set(key, value);
  }

  try {
    const response = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*",
        Referer: `${BUNNY_BASE}/id/bilibili`,
      },
    });

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return json(
      {
        success: false,
        error: "Gagal mengambil CAPTCHA BunnyDL.",
      },
      502
    );
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS,
      });
    }

    if (
      url.pathname === "/api/resolve" &&
      request.method === "POST"
    ) {
      return resolve(request);
    }

    if (
      url.pathname === "/api/captcha-image" &&
      request.method === "GET"
    ) {
      return handleCaptchaImage(request);
    }

    if (
      url.pathname === "/" &&
      request.method === "GET"
    ) {
      return playground();
    }

    return json(
      {
        success: false,
        error: "Endpoint tidak ditemukan.",
        endpoints: {
          playground: "GET /",
          resolve: "POST /api/resolve",
          captcha: "GET /api/captcha-image",
        },
      },
      404
    );
  },
};
