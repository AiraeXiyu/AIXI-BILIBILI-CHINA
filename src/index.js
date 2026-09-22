const BUNNY_BASE = "https://dlbunny.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function normalizeVideo(item) {
  if (!item || typeof item !== "object") return null;

  return {
    url:
      item.url ??
      item.video_url ??
      item.play_addr ??
      item.download_url ??
      null,

    width: item.width ?? null,
    height: item.height ?? null,

    resolution:
      item.resolution ??
      (item.width && item.height
        ? `${item.width}x${item.height}`
        : null),

    format:
      item.ext ??
      item.format ??
      item.media_format ??
      null,

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
      return candidate.map(normalizeVideo).filter(Boolean);
    }

    if (candidate && typeof candidate === "object") {
      return Object.values(candidate)
        .map(normalizeVideo)
        .filter(Boolean);
    }
  }

  return [];
}

async function handleResolve(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: "Request body harus berupa JSON",
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
        error: "Field 'url' wajib diisi",
      },
      400
    );
  }

  if (!captcha_uuid) {
    return json(
      {
        success: false,
        error: "Field 'captcha_uuid' wajib diisi",
      },
      400
    );
  }

  if (!captcha_code) {
    return json(
      {
        success: false,
        error: "Field 'captcha_code' wajib diisi",
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
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
        "Origin": BUNNY_BASE,
        "Referer": `${BUNNY_BASE}/id/bilibili`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "Gagal menghubungi BunnyDL",
        detail: error instanceof Error ? error.message : String(error),
      },
      502
    );
  }

  const contentType = upstream.headers.get("content-type") || "";

  let upstreamData;

  try {
    if (contentType.includes("application/json")) {
      upstreamData = await upstream.json();
    } else {
      const text = await upstream.text();

      try {
        upstreamData = JSON.parse(text);
      } catch {
        upstreamData = {
          raw_response: text,
        };
      }
    }
  } catch (error) {
    return json(
      {
        success: false,
        error: "Response BunnyDL tidak dapat dibaca",
        upstream_status: upstream.status,
      },
      502
    );
  }

  const videos = extractVideos(upstreamData);

  return json({
    success: upstream.ok && videos.length > 0,
    upstream_status: upstream.status,

    request: {
      app: "bilibili",
      app_id: 3,
      format,
    },

    videos,

    // Response asli tetap dikembalikan untuk debugging tahap awal.
    upstream: upstreamData,
  });
}

async function handle(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (url.pathname === "/") {
    return json({
      name: "BunnyDL Bilibili REST API",
      version: "1.0.0",
      status: "online",
      endpoints: {
        resolve: "POST /api/resolve",
      },
    });
  }

  if (url.pathname === "/api/resolve" && request.method === "POST") {
    return handleResolve(request);
  }

  return json(
    {
      success: false,
      error: "Endpoint tidak ditemukan",
    },
    404
  );
}

export default {
  fetch: handle,
};
