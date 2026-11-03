import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { seed } from "../server/domain.mjs";
import { handle } from "../server/handler.mjs";
import { decodeFile, receipt, verifyFile } from "../server/files.mjs";
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-server-key";
process.env.ADMIN_USER_IDS = "admin-user";
process.env.UPLOAD_SIGNING_SECRET = "0123456789abcdef".repeat(4);
process.env.APP_ORIGIN = "http://localhost:5175";
const realFetch = globalThis.fetch;
let state, revision, conflicts, limited;
beforeEach(() => {
  state = { ...structuredClone(seed), orders: [] };
  revision = 0;
  conflicts = 0;
  limited = false;
});
after(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input),
    body =
      options.body && typeof options.body === "string"
        ? JSON.parse(options.body)
        : null;
  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), { status });
  if (url.pathname === "/auth/v1/token")
    return body.password === "correct"
      ? reply({ access_token: "valid-token", user: { id: "admin-user" } })
      : reply({}, 400);
  if (url.pathname === "/auth/v1/user")
    return options.headers.Authorization === "Bearer valid-token"
      ? reply({ id: "admin-user" })
      : options.headers.Authorization === "Bearer nonadmin"
        ? reply({ id: "not-admin" })
        : reply({}, 401);
  if (url.pathname.endsWith("/shop_limit")) return reply(!limited);
  if (url.pathname === "/rest/v1/shop_file_cleanup") return reply([]);
  if (url.pathname === "/rest/v1/shop_state")
    return reply([
      { catalog: { ...structuredClone(state), orders: undefined } },
    ]);
  if (url.pathname === "/rest/v1/shop_orders") {
    const id=url.searchParams.get("id")?.slice(3);
    return reply(state.orders.filter(o=>o.id===id).map(o=>({payload:structuredClone(o)})));
  }
  if (url.pathname.endsWith("/shop_snapshot"))
    return reply({ state: structuredClone(state), revision });
  if (url.pathname.endsWith("/shop_commit")) {
    if (conflicts-- > 0) {
      revision++;
      return reply(false);
    }
    if (body.expected !== revision) return reply(false);
    state = structuredClone(body.next_state);
    revision++;
    return reply(true);
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/"))
    return reply({
      signedURL:
        "/object/sign/order-artwork/uploads/test.png?token=short-lived",
    });
  if (url.pathname.startsWith("/storage/v1/object/"))
    return reply({ ok: true });
  throw Error("Unexpected Supabase call " + url.pathname);
};
async function request(
  route,
  { method = "GET", body, cookie, origin = process.env.APP_ORIGIN } = {},
) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  Object.assign(req, {
    url: "/api/" + route,
    method,
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const headers = {};
  let payload;
  const res = {
    setHeader: (key, value) => (headers[key] = value),
    statusCode: 200,
    end: (value) => (payload = JSON.parse(value)),
  };
  await handle(req, res);
  return { status: res.statusCode, body: payload, headers };
}
const admin = "cc_session=valid-token";
const order = (items = [{ productId: "uv-smart", quantity: 1 }]) => ({
  requestId: randomUUID(),
  customer: "Test Buyer",
  phone: "01983469936",
  location: "Savar Dhaka 1347",
  zone: "dhaka",
  items: items.map(item=>item.productId === 'premium-nfc' ? {...item,nfc:Object.hasOwn(item,'nfc') ? item.nfc : {displayName:'Test NFC Owner'}} : item),
});
test("public catalog excludes customer orders and hidden products", async () => {
  state.products[0].available = false;
  state.orders = [{ customer: "PRIVATE" }];
  const result = await request("catalog");
  assert.equal(result.status, 200);
  assert.equal(result.body.orders, undefined);
  assert.equal(result.body.products.length, 2);
  assert.ok(!JSON.stringify(result.body).includes("PRIVATE"));
});
test("admin data and every mutation require a verified allowed user", async () => {
  for (const [route, method, body] of [
    ["admin", "GET"],
    ["products", "DELETE", { id: "uv-smart" }],
    ["settings", "POST", { businessName: "Attacker" }],
    ["orders", "PATCH", { id: "bad", status: "Completed" }],
    ["categories", "POST", { name: "bad" }],
    ["combos", "DELETE", { id: "bad" }],
    ["order-artwork", "DELETE", { id: "bad" }],
  ]) {
    assert.equal((await request(route, { method, body })).status, 401);
  }
  assert.equal(
    (await request("admin", { cookie: "cc_session=nonadmin" })).status,
    403,
  );
  assert.equal((await request("admin", { cookie: admin })).status, 200);
});
test("login sets HttpOnly cookie; wrong credentials and origins fail", async () => {
  const result = await request("login", {
    method: "POST",
    body: { email: "admin@example.com", password: "correct" },
  });
  assert.equal(result.status, 200);
  assert.match(result.headers["Set-Cookie"], /HttpOnly; SameSite=Strict/);
  assert.equal(result.body.access_token, undefined);
  assert.equal(
    (
      await request("login", {
        method: "POST",
        body: { email: "x", password: "bad" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("login", {
        method: "POST",
        origin: "https://evil.example",
        body: {},
      })
    ).status,
    403,
  );
  assert.equal((await request("logout", { method: "POST" })).status, 200);
});
test("server ignores supplied totals, computes discounts/delivery, deduplicates requests", async () => {
  const body = order();
  body.amount = 1;
  body.items[0].price = 1;
  const first = await request("order-request", { method: "POST", body });
  assert.equal(first.status, 200);
  assert.equal(first.body.amount, 150);
  const second = await request("order-request", { method: "POST", body });
  assert.equal(second.body.id, first.body.id);
  assert.equal(state.orders.length, 1);
  const different = structuredClone(body);
  different.items[0].quantity = 2;
  assert.equal(
    (await request("order-request", { method: "POST", body: different }))
      .status,
    409,
  );
  assert.equal(state.orders[0].payment, "Unpaid — payment not verified");
});
test("unavailable product, malformed details and duplicate variant are rejected", async () => {
  const body = order();
  state.products[0].available = false;
  assert.equal(
    (await request("order-request", { method: "POST", body })).status,
    400,
  );
  state.products[0].available = true;
  for (const changed of [
    { phone: "123" },
    { zone: "unknown" },
    { items: [{ productId: "uv-smart", quantity: 0 }] },
    {
      items: [
        { productId: "uv-smart", quantity: 1 },
        { productId: "uv-smart", quantity: 1 },
      ],
    },
  ])
    assert.equal(
      (
        await request("order-request", {
          method: "POST",
          body: { ...body, ...changed },
        })
      ).status,
      400,
    );
  assert.equal(state.orders.length, 0);
});
test("key-ring variants priced independently, portrait stays private, signed only for admin details", async () => {
  const personalization = {
    bikeBrand: "Yamaha",
    bikeNumber: "DHAKA HA 12-3456",
    ownerName: "TEST OWNER",
    phone: "01983469936",
  };
  const backPhoto = {
    name: "portrait.png",
    receipt: receipt({
      path: `uploads/${randomUUID()}.png`,
      type: "image/png",
      expires: Date.now() + 60000,
    }),
  };
  const result = await request("order-request", {
    method: "POST",
    body: order([
      {
        productId: "bike-keyring",
        quantity: 1,
        printSides: 1,
        personalization,
      },
      {
        productId: "bike-keyring",
        quantity: 1,
        printSides: 2,
        personalization,
        backPhoto,
      },
    ]),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.amount, 600);
  const stored = state.orders[0];
  assert.ok(stored.items[1].backPhoto.path);
  assert.equal(stored.items[0].backPhoto, null);
  assert.equal((await request("order-details?id=" + stored.id)).status, 401);
  const detail = await request("order-details?id=" + stored.id, {
    cookie: admin,
  });
  assert.equal(detail.status, 200);
  assert.match(detail.body.items[1].backPhoto.data, /token=short-lived/);
  assert.equal(new URL(detail.body.items[1].backPhoto.downloadUrl).searchParams.get('download'), 'portrait.png');
  assert.equal(
    (
      await request("order-artwork", {
        method: "DELETE",
        cookie: admin,
        body: { id: stored.id },
      })
    ).status,
    200,
  );
  assert.equal(state.orders[0].items[1].backPhoto, null);
});
test("concurrent revisions retry without overwriting; status changes persist", async () => {
  conflicts = 2;
  const result = await request("order-request", {
    method: "POST",
    body: order(),
  });
  assert.equal(result.status, 200);
  assert.equal(state.orders.length, 1);
  assert.equal(
    (
      await request("orders", {
        method: "PATCH",
        cookie: admin,
        body: { id: result.body.id, status: "Completed" },
      })
    ).status,
    200,
  );
  assert.equal(state.orders[0].status, "Completed");
  assert.equal(
    (
      await request("orders", {
        method: "PATCH",
        cookie: admin,
        body: { id: result.body.id, status: "Invalid" },
      })
    ).status,
    400,
  );
});
test("persistent rate-limit failures and unsupported methods fail closed", async () => {
  limited = true;
  assert.equal(
    (await request("order-request", { method: "POST", body: order() })).status,
    429,
  );
  assert.equal(
    (await request("products", { method: "PUT", cookie: admin, body: {} }))
      .status,
    405,
  );
});
test("files enforce actual type, 2 MB limit and tamper-resistant references", () => {
  assert.throws(() =>
    decodeFile(
      "data:image/png;base64," + Buffer.from("fake png").toString("base64"),
    ),
  );
  assert.throws(() =>
    decodeFile(
      "data:application/pdf;base64," +
        Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
    ),
  );
  assert.throws(() => verifyFile({ receipt: "bad.invalid" }));
  assert.throws(() =>
    verifyFile({
      receipt: receipt({
        path: `uploads/${randomUUID()}.png`,
        type: "image/png",
        expires: 1,
      }),
    }),
  );
  assert.equal(
    decodeFile(
      "data:application/pdf;base64," +
        Buffer.from("%PDF-1.7\n").toString("base64"),
    ).type,
    "application/pdf",
  );
});
test("admin product prices, category rename, combos and delivery settings persist", async () => {
  let product = {
    ...state.products[0],
    price: 120,
    discount: 10,
    discountType: "percent",
  };
  assert.equal(
    (
      await request("products", {
        method: "POST",
        cookie: admin,
        body: product,
      })
    ).status,
    200,
  );
  assert.equal(state.products[0].price, 120);
  assert.equal(
    (
      await request("categories", {
        method: "POST",
        cookie: admin,
        body: { name: "নতুন ক্যাটাগরি", previous: product.category },
      })
    ).status,
    200,
  );
  assert.equal(state.products[0].category, "নতুন ক্যাটাগরি");
  assert.equal(
    (
      await request("settings", {
        method: "POST",
        cookie: admin,
        body: { dhakaFee: 70, freeThreshold: 5 },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("order-request", { method: "POST", body: order() })).body
      .amount,
    178,
  );
  assert.equal(
    (
      await request("combos", {
        method: "POST",
        cookie: admin,
        body: {
          name: "Pair",
          price: 400,
          enabled: true,
          items: [
            { productId: "uv-smart", quantity: 1 },
            { productId: "premium-nfc", quantity: 1 },
          ],
        },
      })
    ).status,
    200,
  );
  const result = await request("order-request", {
    method: "POST",
    body: order([
      { productId: "uv-smart", quantity: 1 },
      { productId: "premium-nfc", quantity: 1 },
    ]),
  });
  assert.equal(result.body.amount, 470);
});

test('NFC orders accept profile instructions without artwork and preserve links in admin details',async()=>{
 const body=order([{productId:'premium-nfc',quantity:1,nfc:{displayName:'Omar',facebook:'facebook.com/CardCraftstudiobd',linkedin:'https://linkedin.com/in/example',other:'Show WhatsApp and opening hours'}}]);
 const result=await request('order-request',{method:'POST',body});
 assert.equal(result.status,200);assert.match(result.body.id,/^CC-[A-F0-9]{12}$/);
 assert.equal(state.orders[0].items[0].file,null);assert.equal(state.orders[0].items[0].nfc.displayName,'Omar');
 assert.equal(state.orders[0].items[0].nfc.facebook,'https://facebook.com/CardCraftstudiobd');
 const details=await request('order-details?id='+result.body.id,{cookie:admin});assert.equal(details.body.items[0].nfc.other,'Show WhatsApp and opening hours');
 const repeat=await request('order-request',{method:'POST',body});assert.equal(repeat.body.id,result.body.id);
});
test('tracking reveals only status/date/id, supports existing IDs, rejects invalid codes and limits attempts',async()=>{
 const placed=await request('order-request',{method:'POST',body:order()});
 const tracked=await request('track',{method:'POST',body:{tracking:placed.body.id.toLowerCase().replace('cc-','CC-')}});
 assert.equal(tracked.status,200);assert.deepEqual(Object.keys(tracked.body).sort(),['date','id','status']);
 assert.equal(tracked.body.status,'Pending');
 await request('orders',{method:'PATCH',cookie:admin,body:{id:placed.body.id,status:'Completed'}});
 assert.equal((await request('track',{method:'POST',body:{tracking:placed.body.id}})).body.status,'Completed');
 assert.equal((await request('track',{method:'POST',body:{tracking:'CC-FFFFFFFFFFFF'}})).status,404);
 assert.equal((await request('track',{method:'POST',body:{tracking:"';select *"}})).status,400);
 state.orders[0].id='CC-'+randomUUID();
 assert.equal((await request('track',{method:'POST',body:{tracking:state.orders[0].id}})).status,200);
 limited=true;assert.equal((await request('track',{method:'POST',body:{tracking:state.orders[0].id}})).status,429);
});
test('NFC name, link schemes and email are validated server-side',async()=>{
 for(const nfc of [null,[],{},{displayName:'Omar',facebook:'javascript:alert(1)'},{displayName:'Omar',email:'not-an-email'}]) {
  assert.equal((await request('order-request',{method:'POST',body:order([{productId:'premium-nfc',quantity:1,nfc}])})).status,400);
 }
 assert.equal(state.orders.length,0);
});
test('NFC orders also accept optional private PDF artwork',async()=>{
 const file={name:'my-card.pdf',receipt:receipt({path:`uploads/${randomUUID()}.pdf`,type:'application/pdf',expires:Date.now()+60000})};
 const response=await request('order-request',{method:'POST',body:order([{productId:'premium-nfc',quantity:1,nfc:{displayName:'Omar'},file}])});
 assert.equal(response.status,200);assert.match(state.orders[0].items[0].file.path,/\.pdf$/);
});
