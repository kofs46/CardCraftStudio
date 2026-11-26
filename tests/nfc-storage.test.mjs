// Image uploads: validation, ownership, publication on save only, cleanup of replaced files.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createApp, tinyPng } from "./helpers/nfc-app.mjs";
import { qrPng } from "../server/nfc-platform/qr.mjs";

let app, cu, c;
before(async () => {
  app = await createApp();
  cu = await app.createCustomer();
  c = await app.activeClient(cu);
});
const upload = (data) => c.req("POST", "/api/nfc/me/upload", { body: { kind: "profile_photo", data } });

test("valid image upload is stored under an unguessable path and returns an owner-bound receipt", async () => {
  const r = await upload(await tinyPng());
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/mock\.supabase\.co\/storage\/v1\/object\/public\/nfc-profile-media\/media\/[0-9a-f-]{36}\.png$/);
  const path = r.body.url.split("/nfc-profile-media/")[1];
  assert.equal(app.state.storage.get(path).type, "image/png");
  // Not public on the profile until saved.
  assert.ok(!(await app.request("GET", `/p/${cu.slug}`)).text.includes(path));
  await c.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { receipt: r.body.receipt } } });
  assert.ok((await app.request("GET", `/p/${cu.slug}`)).text.includes(path));
});

test("invalid file types and spoofed contents are rejected", async () => {
  const gif = "data:image/gif;base64," + Buffer.from("GIF89a....").toString("base64");
  const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 test").toString("base64");
  const spoofed = "data:image/png;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64");
  for (const data of [gif, pdf, spoofed, svg, "not-a-data-url", 42])
    assert.equal((await upload(data)).status, 400, String(data).slice(0, 30));
});

test("oversized files and extreme dimensions are rejected", async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 10);
  Buffer.from(await tinyPng().then((d) => Buffer.from(d.split(",")[1], "base64"))).copy(big);
  assert.equal((await upload("data:image/png;base64," + big.toString("base64"))).status, 400);
  const huge = Buffer.from((await tinyPng()).split(",")[1], "base64");
  huge.writeUInt32BE(20000, 16);
  huge.writeUInt32BE(20000, 20);
  const r = await upload("data:image/png;base64," + huge.toString("base64"));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /dimensions/);
});

test("uploads require a session (customer) or admin login (admin endpoint)", async () => {
  const data = await tinyPng();
  assert.equal((await app.request("POST", "/api/nfc/me/upload", { body: { data } })).status, 401);
  assert.equal((await app.request("POST", "/api/admin/nfc/uploads", { body: { data } })).status, 401);
  assert.equal((await app.admin("POST", "uploads", { body: { data } })).status, 200);
});

test("cross-customer upload prevention", async () => {
  const other = await app.createCustomer();
  const oc = await app.activeClient(other);
  const mine = await upload(await tinyPng());
  const r = await oc.req("PATCH", "/api/nfc/me/profile", { body: { services: [{ title: "Stolen", image: { receipt: mine.body.receipt } }] } });
  assert.equal(r.status, 400);
});

test("replacing or removing images deletes the old file from storage", async () => {
  const first = await upload(await tinyPng());
  await c.req("PATCH", "/api/nfc/me/profile", { body: { cover_image: { receipt: first.body.receipt } } });
  const firstPath = first.body.url.split("/nfc-profile-media/")[1];
  const second = await upload("data:image/png;base64," + qrPng("second", { scale: 2 }).toString("base64"));
  await c.req("PATCH", "/api/nfc/me/profile", { body: { cover_image: { receipt: second.body.receipt } } });
  assert.ok(app.state.deleted.includes(firstPath), "replaced cover deleted");
  const secondPath = second.body.url.split("/nfc-profile-media/")[1];
  assert.ok(app.state.storage.has(secondPath));
  await c.req("PATCH", "/api/nfc/me/profile", { body: { cover_image: null } });
  assert.ok(app.state.deleted.includes(secondPath), "removed cover deleted");
  assert.equal(Number((await app.db.query("select count(*) from nfc_file_cleanup")).rows[0].count), 0);
});

test("service images keep their existing path on resave and are cleaned up when the service is removed", async () => {
  const img = await upload(await tinyPng());
  const saved = await c.req("PUT", "/api/nfc/me/services", { body: { services: [{ title: "Printing", image: { receipt: img.body.receipt } }] } });
  const path = img.body.url.split("/nfc-profile-media/")[1];
  assert.equal(saved.body.services[0].image_path, path);
  const resave = await c.req("PUT", "/api/nfc/me/services", { body: { services: [{ title: "Printing v2", image: { path } }] } });
  assert.equal(resave.body.services[0].image_path, path);
  assert.ok(!app.state.deleted.includes(path));
  await c.req("PUT", "/api/nfc/me/services", { body: { services: [] } });
  assert.ok(app.state.deleted.includes(path));
});

test("deleting a customer removes their media", async () => {
  const d = await app.createCustomer();
  const dc = await app.activeClient(d);
  const img = await dc.req("POST", "/api/nfc/me/upload", { body: { data: await tinyPng() } });
  await dc.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { receipt: img.body.receipt } } });
  await app.admin("DELETE", `customers/${d.id}`, { body: { confirm_user_id: d.userId } });
  assert.ok(app.state.deleted.includes(img.body.url.split("/nfc-profile-media/")[1]));
});

test("visiting-card images enforce ownership and are cleaned up when replaced, removed or deleted", async () => {
  const customer = await app.createCustomer();
  const client = await app.activeClient(customer);
  const uploadCard = async () => (await client.req("POST", "/api/nfc/me/upload", { body: { data: await tinyPng() } })).body;
  const pathFrom = (image) => image.url.split("/nfc-profile-media/")[1];
  const save = (body) => client.req("PATCH", "/api/nfc/me/profile", { body });
  const front = await uploadCard(), back = await uploadCard();
  const foreignImage = (await upload(await tinyPng())).body;
  assert.equal((await save({ visiting_card_front: { receipt: foreignImage.receipt } })).status, 400);
  assert.equal((await save({ visiting_card_front: { receipt: front.receipt }, visiting_card_back: { receipt: back.receipt } })).status, 200);
  const replacement = await uploadCard();
  const resave = await save({ visiting_card_front: { receipt: replacement.receipt }, visiting_card_back: { path: pathFrom(back) } });
  assert.equal(resave.status, 200);
  assert.equal(resave.body.profile.visiting_card_back_url, back.url);
  assert.ok(app.state.deleted.includes(pathFrom(front)));
  assert.equal((await save({ visiting_card_front: null })).status, 200);
  assert.ok(app.state.deleted.includes(pathFrom(replacement)));
  const page = (await app.request("GET", "/p/" + customer.slug)).text;
  assert.ok(page.includes(back.url) && !page.includes(replacement.url));
  assert.equal((await app.admin("DELETE", "customers/" + customer.id, { body: { confirm_user_id: customer.userId } })).status, 200);
  assert.ok(app.state.deleted.includes(pathFrom(back)));
});
