export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function config() {
  const {
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: key,
    ADMIN_USER_IDS: admins,
    UPLOAD_SIGNING_SECRET: secret,
    APP_ORIGIN: origin,
  } = process.env;
  if (!url || !key || !admins || !secret || secret.length < 32 || !origin)
    throw new ApiError(
      "Backend setup incomplete. Configure the server environment.",
      503,
    );
  return {
    url: url.replace(/\/$/, ""),
    key,
    admins: admins.split(",").map((x) => x.trim()),
    secret,
    origin: new URL(origin).origin,
  };
}
export async function sb(
  path,
  { method = "GET", body, headers = {}, raw = false } = {},
) {
  const c = config();
  const response = await fetch(c.url + path, {
    method,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      ...(body && !raw ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.text();
  let data;
  try {
    data = result ? JSON.parse(result) : null;
  } catch {
    data = null;
  }
  if (!response.ok)
    throw new ApiError(
      response.status === 429
        ? "Too many requests. Try again later."
        : "Database or storage operation failed.",
      response.status === 429 ? 429 : 503,
    );
  return data;
}
export const rpc = (name, args) =>
  sb("/rest/v1/rpc/" + name, { method: "POST", body: args });
