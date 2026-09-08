import { renderPainterV1 } from "./templates/painter-v1.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store"
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=UTF-8",
  "cache-control": "public, max-age=60, s-maxage=300",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: HTML_HEADERS });
}

function getSupabaseKey(env) {
  return env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
}

async function getPublishedDemo(env, slug) {
  if (!env.SUPABASE_URL || !getSupabaseKey(env)) {
    throw new Error("Supabase bindings are missing");
  }

  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const endpoint = new URL(`${base}/rest/v1/demos`);
  endpoint.searchParams.set("select", "id,slug,company_name,status,template_key,theme,config,seo,version,published_at,updated_at");
  endpoint.searchParams.set("slug", `eq.${slug}`);
  endpoint.searchParams.set("status", "eq.published");
  endpoint.searchParams.set("limit", "1");

  const key = getSupabaseKey(env);
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase demo lookup failed (${response.status}): ${message.slice(0, 180)}`);
  }

  const rows = await response.json();
  return rows[0] || null;
}

function renderDemo(demo) {
  switch (demo.template_key) {
    case "painter_v1":
      return renderPainterV1(demo);
    default:
      return null;
  }
}

function cleanSlug(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  const slug = parts[0].toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) ? slug : null;
}

function engineHome() {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>De Website Dokter — Demo Engine</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11120f;color:#f4f1e9;font:15px system-ui}.card{width:min(560px,calc(100% - 40px));padding:32px;border:1px solid #2e3029;border-radius:24px;background:#181a16}.tag{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#a9b09a}h1{font:500 42px/1 Georgia,serif;margin:12px 0}p{color:#aeb1a8;line-height:1.7}code{color:#d9d0b9}</style></head><body><main class="card"><div class="tag">De Website Dokter</div><h1>Demo Engine</h1><p>Published prospect-demo's worden dynamisch uit Supabase geladen en gerenderd op hun eigen slug.</p><p><code>/_health</code> · <code>/api/demo/&lt;slug&gt;</code> · <code>/&lt;slug&gt;</code></p></main></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/_health") {
      return json({
        ok: true,
        service: "de-website-dokter-demo-engine",
        version: "dynamic-v1",
        supabaseConfigured: Boolean(env.SUPABASE_URL && getSupabaseKey(env))
      });
    }

    if (url.pathname === "/") {
      return html(engineHome());
    }

    if (url.pathname.startsWith("/api/demo/")) {
      const slug = cleanSlug(url.pathname.replace(/^\/api\/demo\//, "/"));
      if (!slug) return json({ error: "invalid_slug" }, 400);
      try {
        const demo = await getPublishedDemo(env, slug);
        if (!demo) return json({ error: "demo_not_found" }, 404);
        return json({ demo });
      } catch (error) {
        console.error(error);
        return json({ error: "demo_lookup_failed" }, 503);
      }
    }

    // Preserve explicitly requested static assets (images, icons, legacy files, etc.).
    if (/\.[a-z0-9]{2,8}$/i.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const slug = cleanSlug(url.pathname);
    if (!slug) {
      return html("<!doctype html><title>Niet gevonden</title><h1>404</h1>", 404);
    }

    try {
      const demo = await getPublishedDemo(env, slug);
      if (!demo) return html("<!doctype html><title>Demo niet gevonden</title><h1>Demo niet gevonden</h1>", 404);

      const rendered = renderDemo(demo);
      if (!rendered) return html("<!doctype html><title>Template niet beschikbaar</title><h1>Template niet beschikbaar</h1>", 501);

      return html(rendered);
    } catch (error) {
      console.error(error);
      return html("<!doctype html><title>Tijdelijk niet beschikbaar</title><h1>Demo tijdelijk niet beschikbaar</h1>", 503);
    }
  }
};
