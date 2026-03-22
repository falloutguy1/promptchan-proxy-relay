import type { Config, Context } from "@netlify/functions";

type ProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  payload?: Record<string, unknown>;
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "content-type": "application/json",
  };
}

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(JSON.stringify(data), { ...init, headers });
}

function cleanBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed. Use POST." },
      { status: 405 }
    );
  }

  let body: ProxyBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const baseUrl = cleanBaseUrl(body.baseUrl || "");
  const apiKey = (body.apiKey || "").trim();
  const timeoutMs = Math.max(1000, Number(body.timeoutMs) || 120000);
  const payload = body.payload || {};

  if (!baseUrl) {
    return jsonResponse({ error: "Missing baseUrl." }, { status: 400 });
  }
  if (!apiKey) {
    return jsonResponse({ error: "Missing apiKey." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return jsonResponse({ error: "Missing payload object." }, { status: 400 });
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return jsonResponse({ error: "Missing prompt in payload." }, { status: 400 });
  }

  const upstreamUrl = `${baseUrl}/api/external/create`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await upstream.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }

    if (!upstream.ok) {
      return jsonResponse(
        {
          error: "Upstream Promptchan request failed.",
          status: upstream.status,
          statusText: upstream.statusText,
          details: parsed,
        },
        { status: upstream.status }
      );
    }

    return jsonResponse(parsed, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isAbort = error instanceof Error && error.name === "AbortError";
    return jsonResponse(
      {
        error: isAbort ? "The upstream request timed out." : "Proxy relay request failed.",
        details: message,
      },
      { status: isAbort ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const config: Config = {
  path: "/api/promptchan-proxy",
};
