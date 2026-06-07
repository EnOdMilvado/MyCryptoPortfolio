/**
 * Edge proxy that forwards Peatio API calls from a Vercel region close to
 * the GEMS.trade backend. Why: from the Node serverless region (fra1) the
 * outbound landed on the CloudFront IAD12 PoP, which could not reach the
 * GEMS origin and returned the SPA shell with x-cache="Error from
 * cloudfront". Forcing the request through an Edge function in Tokyo
 * (hnd1) puts it on a CloudFront PoP that can actually reach the origin.
 *
 * The Node-side GEMS adapter signs the request (HMAC-SHA256 over nonce +
 * apiKey) and POSTs the path + signed headers to this proxy. The proxy
 * has no secret of its own — it just relays.
 */
export const runtime = "edge";
export const preferredRegion = "hnd1";

interface ProxyRequest {
  path: string;
  headers: Record<string, string>;
}

const ALLOWED_PREFIX = "/api/v2/peatio/";

export async function POST(req: Request): Promise<Response> {
  let body: ProxyRequest;
  try {
    body = (await req.json()) as ProxyRequest;
  } catch {
    return new Response("invalid body", { status: 400 });
  }
  if (
    typeof body.path !== "string" ||
    !body.path.startsWith(ALLOWED_PREFIX) ||
    body.path.includes("..")
  ) {
    return new Response("path not allowed", { status: 400 });
  }
  if (!body.headers || typeof body.headers !== "object") {
    return new Response("missing headers", { status: 400 });
  }
  const upstreamUrl = `https://www.gems.trade${body.path}`;
  const sentHeaderKeys = Object.keys(body.headers).join(",");
  const upstream = await fetch(upstreamUrl, {
    headers: body.headers,
    cache: "no-store",
  });
  const text = await upstream.text();
  // Pass diagnostic CloudFront headers back. Also tag the request with
  // what the proxy actually saw so when the Node-side adapter surfaces a
  // non-JSON response we can tell which header set the proxy forwarded
  // and what status the upstream returned (the response body is the SPA
  // shell so it carries no upstream-status information by itself).
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "x-amz-cf-pop": upstream.headers.get("x-amz-cf-pop") ?? "",
      "x-cache": upstream.headers.get("x-cache") ?? "",
      via: upstream.headers.get("via") ?? "",
      "x-debug-upstream-status": String(upstream.status),
      "x-debug-upstream-content-type": upstream.headers.get("content-type") ?? "",
      "x-debug-sent-headers": sentHeaderKeys,
      "x-debug-body-len": String(text.length),
    },
  });
}
