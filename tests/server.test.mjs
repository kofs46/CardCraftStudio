import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/local.mjs";
test("local HTTP server serves current pages/assets, denies private paths and fails closed without backend configuration", async () => {
  const { server, url } = await startServer({ port: 0 });
  try {
    for (const page of [
      "/",
      "/order-list.html",
      "/cart.html", "/track.html",
      "/admin.html",
      "/images/cardcraft-studio-bd-logo.jpeg",
    ])
      assert.equal((await fetch(url + page)).status, 200, page);
    for (const path of [
      "/server/handler.mjs",
      "/supabase/schema.sql",
      "/.env",
      "/data/studio.sqlite",
      "/package.json",
    ])
      assert.equal((await fetch(url + path)).status, 404, path);
    const response = await fetch(url + "/api/catalog");
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /setup incomplete/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
