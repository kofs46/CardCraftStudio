import { ApiError, config } from "./supabase.mjs";
import { verifyFile } from "./files.mjs";
const fail = (m) => {
  throw new ApiError(m);
};
const text = (v, max = 200) =>
  typeof v === "string" && v.trim().length <= max ? v.trim() : "";
const finite = (v, max = 1e7) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
export const statuses = [
  "Pending",
  "Processing",
  "Printing",
  "Completed",
  "Cancelled",
];
export function validate(route, body, state) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("Invalid request.");
  if (route === "order-request") {
    body = {
      requestId: body.requestId,
      customer: text(body.customer),
      phone: String(body.phone || "")
        .replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d))
        .replace(/[\s-]/g, ""),
      location: text(body.location, 1000),
      requirements: text(body.requirements, 5000),
      zone: body.zone,
      items: body.items,
    };
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        body.requestId || "",
      ) ||
      !body.customer ||
      !/^(?:\+?88)?01[3-9]\d{8}$/.test(body.phone) ||
      body.location.length < 8 ||
      !["dhaka", "outside"].includes(body.zone)
    )
      fail("Check customer, phone, address and delivery area.");
    if (
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > 30
    )
      fail("Choose 1–30 product options.");
    const seen = new Set();
    body.items = body.items.map((i) => {
      const p = state.products.find((p) => p.id === i.productId && p.available);
      const sides =
        p?.customization === "bike-keyring" ? Number(i.printSides || 1) : 1;
      const key = i.productId + "::" + sides;
      if (
        !p ||
        seen.has(key) ||
        ![1, 2].includes(sides) ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 1000
      )
        fail("Check product availability, options and quantities.");
      seen.add(key);
      return {
        productId: p.id,
        quantity: i.quantity,
        printSides: sides,
        personalization: i.personalization,
        file: verifyFile(i.file),
        backPhoto: sides === 2 ? verifyFile(i.backPhoto, true) : null,
      };
    });
  }
  if (route === "products") {
    if (body.id && !state.products.some((p) => p.id === body.id))
      fail("Product not found.");
    if (body.name !== undefined) {
      if (
        !text(body.name) ||
        !finite(body.price) ||
        !state.categories.includes(body.category) ||
        !Array.isArray(body.images) ||
        !body.images.length ||
        body.images.length > 6
      )
        fail("Check product name, category, price and images.");
      for (const src of body.images)
        if (
          typeof src !== "string" ||
          (!(
            /^images\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|svg)$/.test(src) &&
            !src.includes("..")
          ) &&
            !src.startsWith(
              config().url +
                "/storage/v1/object/public/product-images/uploads/",
            ))
        )
          fail("Upload a valid product image.");
      if (
        !finite(
          body.discount || 0,
          body.discountType === "percent" ? 100 : body.price,
        ) ||
        !["fixed", "percent"].includes(body.discountType || "fixed")
      )
        fail("Invalid discount.");
      if (body.customization === "bike-keyring" || body.id === "bike-keyring") {
        if (!finite(body.doublePrice)) fail("Invalid two-side price.");
      }
      body = {
        id: body.id,
        name: text(body.name),
        category: body.category,
        price: body.price,
        doublePrice: body.doublePrice,
        customization:
          body.customization === "bike-keyring" ? "bike-keyring" : undefined,
        images: body.images,
        imageSides: body.images.map((_, i) =>
          ["front", "back", "extra"].includes(body.imageSides?.[i])
            ? body.imageSides[i]
            : i
              ? "back"
              : "front",
        ),
        description: text(body.description, 5000),
        material: text(body.material),
        size: text(body.size),
        available: body.available === true,
        featured: body.featured === true,
        discount: body.discount || 0,
        discountType: body.discountType || "fixed",
      };
    }
  }
  if (
    route === "orders" &&
    (!statuses.includes(body.status) ||
      !state.orders.some((o) => o.id === body.id))
  )
    fail("Invalid order or status.");
  if (route === "order-artwork" && !state.orders.some((o) => o.id === body.id))
    fail("Order not found.");
  if (route === "settings") {
    const next = {};
    for (const key of Object.keys(state.settings))
      if (Object.hasOwn(body, key)) {
        if (["dhakaFee", "outsideFee", "freeThreshold"].includes(key)) {
          if (!finite(body[key], 100000)) fail("Invalid delivery settings.");
          next[key] = body[key];
        } else if (key === "deliveryEnabled") next[key] = body[key] === true;
        else {
          if (typeof body[key] !== "string" || body[key].length > 1000)
            fail("Invalid business settings.");
          next[key] = body[key].trim();
        }
      }
    body = next;
  }
  if (route === "combos" && body.name !== undefined) {
    if (
      !finite(body.price) ||
      !Array.isArray(body.items) ||
      body.items.length > 30 ||
      new Set(body.items.map((i) => i.productId)).size !== body.items.length
    )
      fail("Invalid combo.");
    // Print-side variants have different prices; do not include them in fixed-price bundles.
    if (
      body.items.some(
        (i) =>
          state.products.find((p) => p.id === i.productId)?.customization ===
          "bike-keyring",
      )
    )
      fail("Key-ring variants cannot be included in fixed-price combos.");
  }
  return body;
}
