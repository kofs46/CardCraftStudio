import { createHash, randomUUID } from "node:crypto";
import { ApiError, config, sb, rpc } from "./supabase.mjs";
import { applyAction, seed } from "./domain.mjs";
import { validate } from "./validation.mjs";
import { upload, signedFile } from "./files.mjs";
const methods = {
  catalog: "GET",
  auth: "GET",
  login: "POST",
  logout: "POST",
  admin: "GET",
  "order-details": "GET",
  settings: "POST",
  products: ["POST", "DELETE"],
  categories: ["POST", "DELETE"],
  combos: ["POST", "DELETE"],
  orders: "PATCH",
  "order-artwork": "DELETE",
  "order-request": "POST",
  upload: "POST",
};
async function readBody(req) {
  if (req.body !== undefined) {
    const raw =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > 3000000)
      throw new ApiError("Request too large.", 413);
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApiError("Invalid JSON.");
    }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3000000) throw new ApiError("Request too large.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new ApiError("Invalid JSON.");
  }
}
async function admin(req) {
  const token = String(req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("cc_session="))
    ?.slice(11);
  if (!token) throw new ApiError("Please sign in.", 401);
  let user;
  try {
    user = await sb("/auth/v1/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError("Session expired. Please sign in.", 401);
  }
  if (!config().admins.includes(user.id))
    throw new ApiError("Admin access required.", 403);
  return user;
}
async function snapshot() {
  let result = await rpc("shop_snapshot", {});
  if (!result) {
    await sb("/rest/v1/shop_state?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: { id: true, catalog: seed },
    });
    result = await rpc("shop_snapshot", {});
  }
  if (!result) throw new ApiError("Database has not been initialized.", 503);
  return result;
}
async function cleanup() {
  const pending = await sb("/rest/v1/shop_file_cleanup?select=path&limit=100");
  if (!pending?.length) return;
  await sb("/storage/v1/object/order-artwork", {
    method: "DELETE",
    body: { prefixes: pending.map((f) => f.path) },
  });
  for (const file of pending)
    await sb(
      "/rest/v1/shop_file_cleanup?path=eq." + encodeURIComponent(file.path),
      { method: "DELETE" },
    );
}
function session(res, token, clear = false) {
  res.setHeader(
    "Set-Cookie",
    `cc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 3500}${config().origin.startsWith("https:") ? "; Secure" : ""}`,
  );
}
async function limit(req, kind, max, seconds) {
  // Vercel overwrites x-vercel-forwarded-for; local use the socket address.
  const ip = process.env.VERCEL
    ? req.headers["x-vercel-forwarded-for"] || "unknown"
    : req.socket?.remoteAddress || "local";
  const key = createHash("sha256")
    .update(kind + ":" + ip)
    .digest("hex");
  if (
    !(await rpc("shop_limit", {
      rate_key: key,
      max_hits: max,
      window_seconds: seconds,
    }))
  )
    throw new ApiError("Too many requests. Try again later.", 429);
}
export async function handle(req, res) {
  const trace = randomUUID();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (body, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  try {
    const c = config(),
      url = new URL(req.url, "http://localhost"),
      route =
        req.query?.route ||
        url.searchParams.get("route") ||
        url.pathname.split("/").pop();
    if (!methods[route]) throw new ApiError("Endpoint not found.", 404);
    if (![methods[route]].flat().includes(req.method))
      throw new ApiError("Method not allowed.", 405);
    if (req.method !== "GET") {
      if (req.headers.origin !== c.origin)
        throw new ApiError("Same-origin request required.", 403);
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiError("JSON required.", 415);
    }
    const body = req.method === "GET" ? {} : await readBody(req);
    if (route === "auth") return send({ setupRequired: false });
    if (route === "login") {
      await limit(req, "login", 10, 900);
      if (
        typeof body.email !== "string" ||
        body.email.length > 254 ||
        typeof body.password !== "string" ||
        body.password.length > 200
      )
        throw new ApiError("Invalid credentials.", 401);
      let auth;
      try {
        auth = await sb("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: { email: body.email, password: body.password },
        });
      } catch {
        throw new ApiError("Incorrect email or password.", 401);
      }
      if (!c.admins.includes(auth.user?.id))
        throw new ApiError("Admin access required.", 403);
      session(res, auth.access_token);
      return send({ ok: true });
    }
    if (route === "logout") {
      session(res, "", true);
      return send({ ok: true });
    }
    if (!["catalog", "order-request", "upload"].includes(route))
      await admin(req);
    if (route === "upload") {
      if (body.kind === "product") await admin(req);
      else if (body.kind !== "artwork")
        throw new ApiError("Invalid upload kind.");
      await limit(req, "upload", 80, 3600);
      return send(await upload(body.data, body.kind === "product"));
    }
    if (route === "catalog") {
      const rows = await sb("/rest/v1/shop_state?id=eq.true&select=catalog");
      const catalog = rows?.[0]?.catalog || (await snapshot()).state;
      return send({
        ...catalog,
        orders: undefined,
        products: catalog.products.filter((p) => p.available),
      });
    }
    const snap = await snapshot();
    if (route === "admin") return send(snap.state);
    if (route === "order-details") {
      const order = snap.state.orders.find(
        (o) => o.id === (req.query?.id || url.searchParams.get("id")),
      );
      if (!order) throw new ApiError("Order not found.", 404);
      await Promise.all(
        order.items.map(async (i) => {
          [i.file, i.backPhoto] = await Promise.all([
            signedFile(i.file),
            signedFile(i.backPhoto),
          ]);
        }),
      );
      return send(order);
    }
    if (route === "order-request") await limit(req, "order", 20, 3600);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = attempt ? await snapshot() : snap;
      const input = validate(route, body, current.state);
      const requestHash =
        route === "order-request"
          ? createHash("sha256").update(JSON.stringify(input)).digest("hex")
          : null;
      if (requestHash) {
        const previous = current.state.orders.find(
          (o) => o.requestId === input.requestId,
        );
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ApiError(
              "This request ID was already used with different order details.",
              409,
            );
          return send({ id: previous.id, amount: previous.amount });
        }
      }
      // Portraits were validated as private storage references, not inline browser data.
      const portraits = input.items?.map((i) => i.backPhoto);
      if (route === "order-request")
        input.items.forEach((i) => {
          i.backPhoto = null;
        });
      const response = await applyAction(current.state, "/api/" + route, {
        method: req.method,
        body: JSON.stringify(input),
      });
      const output = await response.json();
      if (!response.ok) throw new ApiError(output.error);
      if (requestHash) {
        const order = output.state.orders.at(-1);
        order.requestHash = requestHash;
        order.items.forEach((i, n) => {
          i.backPhoto = portraits[n];
        });
      }
      if (
        await rpc("shop_commit", {
          expected: current.revision,
          next_state: output.state,
        })
      ) {
        // A failed storage deletion remains queued for the next successful mutation.
        try {
          await cleanup();
        } catch (error) {
          console.error("Artwork cleanup pending", {
            trace,
            message: error.message,
          });
        }
        return send(output.result);
      }
    }
    throw new ApiError("The shop is busy. Please retry.", 409);
  } catch (error) {
    if (!error.status)
      console.error("API failure", { trace, message: error.message });
    send(
      {
        error: error.status
          ? error.message
          : "Unexpected server error. Please retry.",
        reference: trace,
      },
      error.status || 500,
    );
  }
}
