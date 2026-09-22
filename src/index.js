const BUNNY = "https://dlbunny.com";

const SESSION_TTL = 10 * 60; // 10 menit

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function randomId(length = 32) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  const bytes = crypto.getRandomValues(new Uint8Array(length));

  let result = "";

  for (const byte of bytes) {
    result += chars[byte % chars.length];
  }

  return result;
}

/*
 * Ambil semua Set-Cookie dari response upstream.
 * Workers mendukung Headers.getSetCookie().
 */
function getSetCookies(headers) {
  try {
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }
  } catch (_) {}

  const single = headers.get("set-cookie");

  if (!single) return [];

  return [single];
}

/*
 * Ubah Set-Cookie menjadi Cookie header.
 */
function mergeCookies(existing, setCookies) {
  const jar = new Map();

  function addCookieString(cookieString) {
    if (!cookieString) return;

    const parts = cookieString.split(";");

    for (const part of parts) {
      const item = part.trim();

      if (!item) continue;

      const equal = item.indexOf("=");

      if (equal === -1) continue;

      const name = item.slice(0, equal).trim();
      const value = item.slice(equal + 1).trim();

      if (!name) continue;

      jar.set(name, value);
      break;
    }
  }

  if (existing) {
    for (const item of existing.split(";")) {
      addCookieString(item);
    }
  }

  for (const cookie of setCookies) {
    addCookieString(cookie);
  }

  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractCaptchaUUID(htmlText) {
  /*
   * Target:
   * <img id="VerifyCaptchaIMG" uuid="XXXXXXXX" ...>
   */

  const patterns = [
    /id=["']VerifyCaptchaIMG["'][^>]*uuid=["']([^"']+)["']/i,
    /uuid=["']([^"']+)["'][^>]*id=["']VerifyCaptchaIMG["']/i,
  ];

  for (const regex of patterns) {
    const match = htmlText.match(regex);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function saveSession(env, sessionId, session) {
  await env.SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify(session),
    {
      expirationTtl: SESSION_TTL,
    }
  );
}

async function getSession(env, sessionId) {
  if (!sessionId) return null;

  const raw = await env.SESSIONS.get(`session:${sessionId}`);

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function deleteSession(env, sessionId) {
  if (!sessionId) return;

  await env.SESSIONS.delete(`session:${sessionId}`);
}

/*
 * Bu request hanya mengambil halaman BunnyDL
 * untuk mendapatkan cookie/session normal.
 */
async function createSession(env) {
  const sessionId = randomId(40);

  const response = await fetch(`${BUNNY}/id/bilibili`, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/149 Mobile Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!response.ok) {
    throw new Error(`BunnyDL page HTTP ${response.status}`);
  }

  const page = await response.text();

  const setCookies = getSetCookies(response.headers);

  let cookie = mergeCookies("", setCookies);

  const captchaUUID = extractCaptchaUUID(page);

  /*
   * Kalau halaman tidak memberi UUID langsung,
   * tetap simpan session dan biarkan endpoint captcha
   * bekerja menggunakan cookie yang sama.
   */
  const session = {
    cookie,
    captchaUUID,
    createdAt: Date.now(),
  };

  await saveSession(env, sessionId, session);

  return {
    sessionId,
    captchaUUID,
  };
}

/*
 * GET /api/session
 */
async function handleCreateSession(env) {
  try {
    const result = await createSession(env);

    return json({
      status: 200,
      success: true,
      message: "Session berhasil dibuat",
      session_id: result.sessionId,
      captcha_uuid: result.captchaUUID,
      expires_in: SESSION_TTL,
    });
  } catch (error) {
    return json(
      {
        status: 500,
        success: false,
        message: "Gagal membuat session",
        error: error.message,
      },
      500
    );
  }
}

/*
 * GET /api/captcha?session_id=xxx
 */
async function handleCaptcha(request, env) {
  const url = new URL(request.url);

  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return json(
      {
        status: 400,
        success: false,
        message: "session_id wajib diisi",
      },
      400
    );
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    return json(
      {
        status: 404,
        success: false,
        message: "Session tidak ditemukan atau sudah expired",
      },
      404
    );
  }

  const rand = Math.floor(Math.random() * 1000000);

  const captchaURL =
    `${BUNNY}/api/get_captcha?rand=${rand}`;

  const response = await fetch(captchaURL, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/149 Mobile Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": `${BUNNY}/id/bilibili`,
      "Cookie": session.cookie || "",
    },
  });

  if (!response.ok) {
    return json(
      {
        status: response.status,
        success: false,
        message: "Gagal mengambil CAPTCHA dari BunnyDL",
      },
      response.status
    );
  }

  /*
   * Kalau endpoint CAPTCHA memberikan cookie baru,
   * masukkan ke session yang sama.
   */
  const newCookies = getSetCookies(response.headers);

  if (newCookies.length) {
    session.cookie = mergeCookies(
      session.cookie,
      newCookies
    );

    await saveSession(env, sessionId, session);
  }

  const contentType =
    response.headers.get("content-type") ||
    "image/png";

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      ...CORS_HEADERS,
    },
  });
}

/*
 * Cari array video_play_addr di response BunnyDL
 */
function findVideoPlayAddr(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoPlayAddr(item);

      if (found) return found;
    }

    return null;
  }

  if (
    Array.isArray(value.video_play_addr)
  ) {
    return value.video_play_addr;
  }

  for (const key of Object.keys(value)) {
    const found = findVideoPlayAddr(value[key]);

    if (found) return found;
  }

  return null;
}

/*
 * Cari auto_stand_url
 */
function findAutoStandURL(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAutoStandURL(item);

      if (found) return found;
    }

    return null;
  }

  if (
    typeof value.auto_stand_url === "string" &&
    value.auto_stand_url
  ) {
    return value.auto_stand_url;
  }

  for (const key of Object.keys(value)) {
    const found = findAutoStandURL(value[key]);

    if (found) return found;
  }

  return null;
}

/*
 * POST /api/resolve
 */
async function handleResolve(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (_) {
    return json(
      {
        status: 400,
        success: false,
        message: "Body harus JSON",
      },
      400
    );
  }

  const sessionId =
    typeof body.session_id === "string"
      ? body.session_id.trim()
      : "";

  const bilibiliUrl =
    typeof body.url === "string"
      ? body.url.trim()
      : "";

  const captchaCode =
    typeof body.captcha_code === "string"
      ? body.captcha_code.trim()
      : "";

  const format =
    typeof body.format === "string"
      ? body.format.trim().toLowerCase()
      : "mp4";

  if (!sessionId) {
    return json(
      {
        status: 400,
        success: false,
        message: "session_id wajib diisi",
      },
      400
    );
  }

  if (!bilibiliUrl) {
    return json(
      {
        status: 400,
        success: false,
        message: "URL BiliBili wajib diisi",
      },
      400
    );
  }

  if (!captchaCode) {
    return json(
      {
        status: 400,
        success: false,
        message: "Kode CAPTCHA wajib diisi",
      },
      400
    );
  }

  if (!["mp4", "mp3", "jpeg"].includes(format)) {
    return json(
      {
        status: 400,
        success: false,
        message: "Format harus mp4, mp3, atau jpeg",
      },
      400
    );
  }

  const session = await getSession(env, sessionId);

  if (!session) {
    return json(
      {
        status: 404,
        success: false,
        message:
          "Session expired. Buat session baru dan CAPTCHA baru.",
      },
      404
    );
  }

  /*
   * Payload mengikuti flow BunnyDL yang sudah kita temukan.
   */
  const payload = {
    user_uuid_text: session.captchaUUID || "",
    user_input_text: bilibiliUrl,
    user_select_media_format: format,
    user_select_appid: 3,
    user_select_app: "bilibili",
    user_input_captcha_text: captchaCode,
    user_anonymous: true,
  };

  let response;

  try {
    response = await fetch(
      `${BUNNY}/api/create_oxy_order`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/149 Mobile Safari/537.36",
          "Referer": `${BUNNY}/id/bilibili`,
          "Origin": BUNNY,
          "Cookie": session.cookie || "",
        },
        body: JSON.stringify(payload),
      }
    );
  } catch (error) {
    return json(
      {
        status: 502,
        success: false,
        message: "Gagal menghubungi BunnyDL",
        error: error.message,
      },
      502
    );
  }

  const text = await response.text();

  let upstream;

  try {
    upstream = JSON.parse(text);
  } catch (_) {
    upstream = {
      raw: text,
    };
  }

  /*
   * Update cookie kalau upstream memberikan cookie baru.
   */
  const newCookies = getSetCookies(response.headers);

  if (newCookies.length) {
    session.cookie = mergeCookies(
      session.cookie,
      newCookies
    );

    await saveSession(env, sessionId, session);
  }

  const videoPlayAddr =
    findVideoPlayAddr(upstream);

  const autoStandURL =
    findAutoStandURL(upstream);

  /*
   * Kalau CAPTCHA salah, BunnyDL biasanya
   * mengembalikan status 409.
   */
  if (
    upstream &&
    (
      upstream.status === 409 ||
      upstream.code === 409
    )
  ) {
    return json(
      {
        status: 409,
        success: false,
        message:
          upstream.info ||
          upstream.message ||
          "Kode CAPTCHA salah",
        upstream,
      },
      409
    );
  }

  const success =
    response.ok &&
    (
      !!videoPlayAddr ||
      !!autoStandURL
    );

  /*
   * Session hanya dipakai sebentar.
   * Setelah resolve selesai kita hapus supaya
   * cookie tidak disimpan lebih lama dari perlu.
   */
  await deleteSession(env, sessionId);

  return json({
    status: upstream?.status ?? response.status,
    success,
    message: success
      ? "Berhasil mendapatkan hasil BunnyDL"
      : (
          upstream?.info ||
          upstream?.message ||
          "BunnyDL tidak mengembalikan hasil download"
        ),

    resolution: videoPlayAddr || [],

    download_url:
      autoStandURL || null,

    upstream,
  });
}

/*
 * Playground
 */
function playground() {
  return html(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>BunnyDL BiliBili API</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 20px 14px 40px;
      font-family: Arial, sans-serif;
      background: #f4f6f8;
      color: #111;
    }

    .container {
      width: 100%;
      max-width: 600px;
      margin: auto;
    }

    .card {
      background: white;
      border-radius: 18px;
      padding: 18px;
      margin-bottom: 14px;
      box-shadow: 0 8px 30px rgba(0,0,0,.06);
    }

    h1 {
      font-size: 23px;
      margin: 0 0 7px;
    }

    p {
      color: #666;
      line-height: 1.5;
      font-size: 14px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: bold;
      margin: 15px 0 7px;
    }

    input,
    select,
    button {
      width: 100%;
      min-height: 46px;
      border-radius: 12px;
      border: 1px solid #ddd;
      padding: 0 13px;
      font-size: 14px;
    }

    input,
    select {
      background: white;
    }

    button {
      border: 0;
      background: #111;
      color: white;
      font-weight: bold;
      margin-top: 14px;
      cursor: pointer;
    }

    button:disabled {
      opacity: .5;
    }

    .captcha-box {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    }

    .captcha-box img {
      width: 150px;
      height: 50px;
      object-fit: contain;
      background: #eee;
      border-radius: 8px;
    }

    .small-button {
      width: auto;
      padding: 0 14px;
      min-height: 40px;
      margin: 0;
      background: #eee;
      color: #111;
    }

    .status {
      font-size: 13px;
      margin-top: 10px;
      color: #666;
    }

    .result {
      white-space: pre-wrap;
      word-break: break-word;
      background: #111;
      color: #eee;
      border-radius: 12px;
      padding: 13px;
      font-size: 12px;
      max-height: 500px;
      overflow: auto;
    }

    .resolution {
      border: 1px solid #eee;
      border-radius: 12px;
      padding: 12px;
      margin-top: 10px;
    }

    .resolution strong {
      display: block;
      margin-bottom: 4px;
    }

    .download {
      display: block;
      text-align: center;
      text-decoration: none;
      background: #111;
      color: white;
      padding: 12px;
      border-radius: 10px;
      margin-top: 8px;
      font-size: 13px;
    }

    .hidden {
      display: none;
    }
  </style>
</head>

<body>

<div class="container">

  <div class="card">
    <h1>BunnyDL BiliBili API</h1>

    <p>
      Masukkan URL BiliBili, CAPTCHA manual,
      lalu Execute.
    </p>

    <div class="status" id="sessionStatus">
      Membuat session...
    </div>
  </div>

  <div class="card">

    <label>URL BiliBili</label>

    <input
      id="videoUrl"
      type="url"
      placeholder="https://www.bilibili.com/video/..."
    >

    <label>CAPTCHA</label>

    <div class="captcha-box">

      <img
        id="captchaImage"
        alt="CAPTCHA"
      >

      <button
        class="small-button"
        id="refreshCaptcha"
        type="button"
      >
        Refresh
      </button>

    </div>

    <input
      id="captchaCode"
      type="text"
      maxlength="4"
      autocomplete="off"
      placeholder="Masukkan teks CAPTCHA"
    >

    <label>Format</label>

    <select id="format">
      <option value="mp4">MP4</option>
      <option value="mp3">MP3</option>
      <option value="jpeg">JPEG</option>
    </select>

    <button id="execute">
      Execute
    </button>

    <div class="status" id="status"></div>

  </div>

  <div
    class="card hidden"
    id="resolutionCard"
  >

    <h2>Resolution</h2>

    <div id="resolutionList"></div>

    <div id="autoDownload"></div>

  </div>

  <div class="card">

    <h2>Response</h2>

    <div
      class="result"
      id="response"
    >
      Belum ada response.
    </div>

  </div>

</div>

<script>
  let sessionId = null;

  const $ = (id) =>
    document.getElementById(id);

  async function createSession() {

    $("sessionStatus").textContent =
      "Membuat session BunnyDL...";

    try {

      const response =
        await fetch("/api/session");

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          "Gagal membuat session"
        );
      }

      sessionId =
        data.session_id;

      $("sessionStatus").textContent =
        "Session aktif.";

      await refreshCaptcha();

    } catch (error) {

      $("sessionStatus").textContent =
        "Error: " + error.message;
    }
  }

  async function refreshCaptcha() {

    if (!sessionId) {
      await createSession();
      return;
    }

    const image =
      $("captchaImage");

    image.src =
      "/api/captcha?session_id=" +
      encodeURIComponent(sessionId) +
      "&t=" +
      Date.now();

    $("captchaCode").value = "";

    $("status").textContent =
      "CAPTCHA baru dimuat.";
  }

  async function execute() {

    if (!sessionId) {
      $("status").textContent =
        "Session belum siap.";

      return;
    }

    const url =
      $("videoUrl").value.trim();

    const captcha =
      $("captchaCode").value.trim();

    const format =
      $("format").value;

    if (!url) {
      $("status").textContent =
        "URL BiliBili wajib diisi.";

      return;
    }

    if (!captcha) {
      $("status").textContent =
        "CAPTCHA wajib diisi.";

      return;
    }

    const button =
      $("execute");

    button.disabled = true;

    $("status").textContent =
      "Memproses...";

    $("response").textContent =
      "Loading...";

    $("resolutionCard")
      .classList.add("hidden");

    try {

      const response =
        await fetch("/api/resolve", {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({

            session_id:
              sessionId,

            url,

            captcha_code:
              captcha,

            format
          })
        });

      const data =
        await response.json();

      $("response").textContent =
        JSON.stringify(
          data,
          null,
          2
        );

      if (
        data.status === 409 ||
        response.status === 409
      ) {

        $("status").textContent =
          "CAPTCHA salah. Refresh CAPTCHA lalu coba lagi.";

        await refreshCaptcha();

        return;
      }

      if (
        data.success &&
        Array.isArray(data.resolution)
      ) {

        renderResolutions(
          data.resolution
        );

        $("resolutionCard")
          .classList.remove("hidden");
      }

      if (data.download_url) {

        $("autoDownload").innerHTML =
          '<a class="download" href="' +
          escapeHTML(data.download_url) +
          '" target="_blank" rel="noopener">' +
          'Download Auto Stand' +
          '</a>';
      }

      $("status").textContent =
        data.message ||
        "Selesai.";

    } catch (error) {

      $("status").textContent =
        "Error: " +
        error.message;

      $("response").textContent =
        error.stack ||
        error.message;

    } finally {

      button.disabled = false;
    }
  }

  function renderResolutions(list) {

    const container =
      $("resolutionList");

    container.innerHTML = "";

    if (!list.length) {

      container.innerHTML =
        "<p>Tidak ada resolution yang dikembalikan.</p>";

      return;
    }

    list.forEach((item, index) => {

      const wrapper =
        document.createElement("div");

      wrapper.className =
        "resolution";

      const width =
        item.width || "";

      const height =
        item.height || "";

      const resolution =
        width && height
          ? width + "x" + height
          : (
              item.resolution ||
              item.media_desc ||
              "Resolution " + (index + 1)
            );

      const format =
        item.media_format ||
        item.format ||
        "";

      const size =
        item.file_size ||
        item.filesize ||
        item.size ||
        "";

      wrapper.innerHTML =
        "<strong>" +
        escapeHTML(String(resolution)) +
        "</strong>" +

        "<div>" +
        escapeHTML(String(format)) +
        (size
          ? " · " + escapeHTML(String(size))
          : "") +
        "</div>";

      const url =
        item.url ||
        item.download_url ||
        item.video_url ||
        item.play_url ||
        item.auto_stand_url ||
        item.src;

      if (url) {

        const link =
          document.createElement("a");

        link.className =
          "download";

        link.href = url;

        link.target =
          "_blank";

        link.rel =
          "noopener";

        link.textContent =
          "Download";

        wrapper.appendChild(link);
      }

      container.appendChild(
        wrapper
      );
    });
  }

  function escapeHTML(value) {

    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  $("refreshCaptcha")
    .addEventListener(
      "click",
      refreshCaptcha
    );

  $("execute")
    .addEventListener(
      "click",
      execute
    );

  createSession();
</script>

</body>
</html>
  `);
}

export default {
  async fetch(request, env) {

    const url =
      new URL(request.url);

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {

      return playground();
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/session"
    ) {

      return handleCreateSession(env);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/captcha"
    ) {

      return handleCaptcha(
        request,
        env
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/resolve"
    ) {

      return handleResolve(
        request,
        env
      );
    }

    return json(
      {
        status: 404,
        success: false,
        message: "Endpoint tidak ditemukan",
        endpoints: {
          playground: "GET /",
          session: "GET /api/session",
          captcha: "GET /api/captcha?session_id=...",
          resolve: "POST /api/resolve",
        },
      },
      404
    );
  },
};
