import { randomUUID, randomBytes } from "node:crypto";
// Shared helpers and page-specific behavior for the existing site.
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  new Intl.NumberFormat("bn-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2,
  }).format(value);
const digits = (value) =>
  String(value).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d));
const imageSide = (p, i) =>
  p.imageSides?.[i] || (i === 0 ? "front" : i === 1 ? "back" : "extra");
const sideLabel = (side) =>
  ({ front: "সামনের দিক", back: "পেছনের দিক", extra: "অন্যান্য ছবি" })[side] ||
  "অন্যান্য ছবি";
const imageUrl = (src) =>
  src === "images/product-keyring-photo.jpg"
    ? "images/product-keyring-photo.png"
    : String(src || "");

// Frontend preview only: no API requests, passwords or server authentication.
const previewSeed = [
  {
    id: "uv-smart",
    name: "ইউভি স্মার্ট কার্ড",
    category: "স্মার্ট কার্ড",
    description:
      "নিজের নাম, লোগো বা ব্র্যান্ড ডিজাইনে UV প্রিন্টের স্মার্ট কার্ড। পছন্দের সামনের ও পেছনের ডিজাইন দিয়ে অর্ডার করুন।",
    price: 150,
    images: ["images/demo-business-front.png", "images/demo-business-back.png"],
    material: "UV প্রিন্টেড PVC",
    size: "85.6 × 54 mm",
    featured: true,
    imageSides: ["front", "back"],
    available: true,
  },
  {
    id: "premium-nfc",
    name: "প্রিমিয়াম NFC কার্ড",
    category: "NFC কার্ড",
    description:
      "ব্যক্তিগত বা ব্যবসায়িক পরিচিতির জন্য প্রিমিয়াম NFC কার্ড। নিজের লোগো ও ডিজাইন ব্যবহার করুন; NFC সেটআপের প্রয়োজন অর্ডারের নোটে জানান।",
    price: 400,
    images: ["images/product-nfc-front.svg", "images/product-nfc-back.svg"],
    material: "NFC PVC কার্ড",
    size: "85.6 × 54 mm",
    featured: true,
    imageSides: ["front", "back"],
    available: true,
  },
  {
    id: "bike-keyring",
    name: "বাইক কি রিং",
    category: "বাইক এক্সেসরিজ",
    description:
      "নিজের বাইকের ব্র্যান্ড, নম্বর, নাম ও ফোন নম্বর দিয়ে কাস্টম কি রিং। এক পাশে প্রিন্ট অথবা দুই পাশে প্রিন্ট বেছে নিন; দুই পাশে নিলে পেছনে নিজের ছবিও দিতে পারবেন।",
    price: 250,
    doublePrice: 300,
    customization: "bike-keyring",
    images: [
      "images/product-keyring-photo.png",
      "images/product-keyring-photo-back.svg",
    ],
    imageSides: ["front", "back"],
    material: "কাস্টম প্রিন্টেড কি রিং",
    size: "ডিজাইন অনুযায়ী",
    featured: true,
    available: true,
  },
];

const previewDefaults = {
  businessName: "CardCraft Studio BD",
  phone: "01983469936",
  phone2: "",
  address: "সাভার,ঢাকা-১৩৪৭।",
  email: "cardcraftstuiobd@gmail.com",
  whatsapp: "01983469936",
  bkash: "",
  nagad: "",
  facebook: "https://www.facebook.com/CardCraftstudiobd",
  instagram: "",
  youtube: "",
  tiktok: "",
  deliveryEnabled: true,
  dhakaFee: 50,
  outsideFee: 50,
  freeThreshold: 3,
};
const isBikeKeyring = (p) =>
  p?.customization === "bike-keyring" || p?.id === "bike-keyring";
const printPrice = (p, sides = 1) =>
  p.id === "premium-nfc" ? 400 : p.id === "uv-smart" ? 150 :
  isBikeKeyring(p) && Number(sides) === 2 ? p.doublePrice : p.price;
// Repeat five-piece UV packs, then price the remaining pieces by their tier.
const quantityPrice = (p, quantity) => p.id === "uv-smart" || p.productId === "uv-smart"
  ? Math.floor(quantity / 5) * 600 + [0, 150, 250, 350, 500][quantity % 5]
  : p.id === "premium-nfc" ? 400 * quantity
  : unitPrice({ ...p, price: printPrice(p, p.printSides) }) * quantity;
function keyringDetails(item) {
  const printSides = Number(item.printSides ?? 1);
  if (![1, 2].includes(printSides))
    throw Error("এক পাশে অথবা দুই পাশে প্রিন্ট বেছে নিন।");
  const raw = item.personalization || {};
  const personalization = {
    bikeBrand: String(raw.bikeBrand || "").trim(),
    bikeNumber: String(raw.bikeNumber || "").trim(),
    ownerName: String(raw.ownerName || "").trim(),
    phone: digits(String(raw.phone || "")).replace(/[\s-]/g, ""),
  };
  if (!personalization.bikeBrand || personalization.bikeBrand.length > 80)
    throw Error("বাইকের ব্র্যান্ডের নাম দিন (সর্বোচ্চ ৮০ অক্ষর)।");
  if (!/^[A-Za-z0-9][A-Za-z0-9 /-]{1,49}$/.test(personalization.bikeNumber))
    throw Error("বাইকের নম্বর ইংরেজি অক্ষর ও সংখ্যায় লিখুন।");
  if (!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(personalization.ownerName))
    throw Error("নিজের নাম ইংরেজিতে লিখুন (সর্বোচ্চ ৮০ অক্ষর)।");
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(personalization.phone))
    throw Error("কি রিংয়ে প্রিন্টের জন্য সঠিক ফোন নম্বর দিন।");
  let backPhoto = null;
  if (printSides === 2 && item.backPhoto) {
    const photo = item.backPhoto;
    if (
      typeof photo.name !== "string" ||
      !photo.name ||
      photo.name.length > 255 ||
      typeof photo.data !== "string" ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        photo.data,
      ) ||
      photo.data.length > (2 * 1024 * 1024 * 4) / 3 + 100
    )
      throw Error("পেছনের ছবির জন্য সর্বোচ্চ ২ এমবি PNG, JPEG বা WebP দিন।");
    backPhoto = { name: photo.name, data: photo.data };
  }
  return { printSides, personalization, backPhoto };
}
const unitPrice = (p) =>
  Math.max(
    0,
    Math.round(
      (p.price -
        (p.discountType === "percent"
          ? (p.price * (Number(p.discount) || 0)) / 100
          : Number(p.discount) || 0)) *
        100,
    ) / 100,
  );
function previewTotals(items, data, zone = "dhaka") {
  const rows = items.map((i) => {
    const p = data.products.find((p) => p.id === i.productId) || i;
    return { ...i, product: { ...p, price: printPrice(p, i.printSides) } };
  });
  const quantity = rows.reduce((n, i) => n + i.quantity, 0),
    base = rows.reduce((n, i) => n + (i.productId === "uv-smart" ? quantityPrice(i.product, i.quantity) : i.product.price * i.quantity), 0);
  let net = rows.reduce((n, i) => n + quantityPrice(i.product, i.quantity), 0),
    offer = "";
  for (const combo of data.combos.filter((c) => c.enabled && !rows.some(r => ["uv-smart", "premium-nfc"].includes(r.productId)))) {
    if (
      !combo.items.length ||
      !combo.items.every((i) =>
        data.products.some((p) => p.id === i.productId && p.available),
      )
    )
      continue;
    const sets = Math.min(
      ...combo.items.map((i) =>
        Math.floor(
          (rows.find((r) => r.productId === i.productId)?.quantity || 0) /
            i.quantity,
        ),
      ),
    );
    if (!sets) continue;
    const candidate =
      sets * combo.price +
      rows.reduce(
        (n, row) =>
          n +
          Math.max(
            0,
            row.quantity -
              sets *
                (combo.items.find((i) => i.productId === row.productId)
                  ?.quantity || 0),
          ) *
            unitPrice(row.product),
        0,
      );
    if (candidate < net) {
      net = candidate;
      offer = combo.name + " × " + sets;
    }
  }
  const settings = data.settings,
    delivery =
      !quantity ||
      !settings.deliveryEnabled ||
      quantity > 2 ||
      rows.every(r => r.productId === "premium-nfc") ||
      (settings.freeThreshold > 0 && quantity >= settings.freeThreshold)
        ? 0
        : zone === "outside"
          ? settings.outsideFee
          : settings.dhakaFee;
  return {
    quantity,
    subtotal: Math.round(base * 100) / 100,
    discount: Math.round((base - net) * 100) / 100,
    net: Math.round(net * 100) / 100,
    delivery,
    amount: Math.round((net + delivery) * 100) / 100,
    offer,
    nextUvDiscountPercent: quantity >= 5 ? 10 : 0,
  };
}

export async function applyAction(state, url, options = {}) {
  try {
    const route = url.replace("/api/", ""),
      method = options.method || "GET",
      body = options.body ? JSON.parse(options.body) : {},
      data = structuredClone(state);
    let result = { ok: true };
    if (route === "auth") result = { setupRequired: false };
    else if (route === "login" || route === "logout") {
    } else if (route === "catalog")
      result = {
        products: data.products.filter((p) => p.available),
        categories: data.categories,
        settings: data.settings,
        combos: data.combos,
      };
    else if (route === "admin") result = data;
    else if (route === "settings") {
      const next = { ...data.settings, ...body };
      for (const key of ["dhakaFee", "outsideFee", "freeThreshold"])
        if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 100000)
          throw Error("Enter valid non-negative delivery values.");
      if (!Number.isInteger(next.freeThreshold))
        throw Error("Free delivery quantity must be a whole number.");
      for (const key of ["facebook", "instagram", "youtube", "tiktok"])
        if (next[key] && !/^https?:\/\//i.test(next[key]))
          throw Error("Social links must start with https:// or http://.");
      data.settings = next;
    } else if (route === "combos") {
      if (method === "DELETE")
        data.combos = data.combos.filter((c) => c.id !== body.id);
      else {
        if (
          !body.name?.trim() ||
          !Number.isFinite(body.price) ||
          body.price < 0 ||
          !body.items?.length ||
          body.items.some(
            (i) =>
              !data.products.some((p) => p.id === i.productId) ||
              !Number.isInteger(i.quantity) ||
              i.quantity < 1,
          )
        )
          throw Error(
            "Enter a name, price and product quantities for the combo.",
          );
        const combo = {
          ...body,
          id: body.id || "combo-" + randomUUID(),
        };
        data.combos = data.combos.some((c) => c.id === combo.id)
          ? data.combos.map((c) => (c.id === combo.id ? combo : c))
          : [...data.combos, combo];
      }
    } else if (route === "categories") {
      if (method === "DELETE") {
        if (data.products.some((p) => p.category === body.name))
          throw Error("Move or delete the category products first.");
        data.categories = data.categories.filter((c) => c !== body.name);
      } else {
        const name = String(body.name || "").trim();
        if (
          !name ||
          data.categories.some(
            (c) =>
              c.toLowerCase() === name.toLowerCase() && c !== body.previous,
          )
        )
          throw Error("Enter a unique category name.");
        data.categories = body.previous
          ? data.categories.map((c) => (c === body.previous ? name : c))
          : [...data.categories, name];
        if (body.previous)
          data.products = data.products.map((p) =>
            p.category === body.previous ? { ...p, category: name } : p,
          );
      }
    } else if (route === "products") {
      if (method === "DELETE")
        data.products = data.products.filter((p) => p.id !== body.id);
      else {
        if (
          !body.name?.trim() ||
          !data.categories.includes(body.category) ||
          !Number.isFinite(body.price) ||
          body.price < 0
        )
          throw Error("Name, category and a valid price are required.");
        if (
          !Array.isArray(body.images) ||
          !body.images.length ||
          body.images.length > 6
        )
          throw Error("Add one to six product images.");
        if (
          !Number.isFinite(body.discount || 0) ||
          (body.discount || 0) < 0 ||
          (body.discount || 0) >
            (body.discountType === "percent" ? 100 : body.price)
        )
          throw Error(
            "Discount must be within the product price or 0–100 percent.",
          );
        const existing = data.products.find((p) => p.id === body.id);
        if (isBikeKeyring(existing) || isBikeKeyring(body)) {
          if (
            !Number.isFinite(body.doublePrice) ||
            body.doublePrice < 0 ||
            body.doublePrice > 10000000
          )
            throw Error("দুই পাশে প্রিন্টের সঠিক মূল্য দিন।");
          body.customization = "bike-keyring";
        }
        const product = {
          ...body,
          id: body.id || "product-" + randomUUID(),
          finishes: ["Matte", "Gloss"],
          colors: ["#0f766e"],
          currency: "BDT",
        };
        data.products = data.products.some((p) => p.id === product.id)
          ? data.products.map((p) => (p.id === product.id ? product : p))
          : [...data.products, product];
        result.id = product.id;
      }
    } else if (route === "orders") {
      data.orders = data.orders.map((o) =>
        o.id === body.id ? { ...o, status: body.status } : o,
      );
    } else if (route === "order-artwork") {
      data.orders = data.orders.map((o) =>
        o.id === body.id
          ? {
              ...o,
              items: o.items.map((i) => ({
                ...i,
                file: null,
                pieceFiles: [],
                backPhoto: null,
              })),
            }
          : o,
      );
    } else if (route === "order-request") {
      let order = data.orders.find((o) => o.requestId === body.requestId);
      if (!order) {
        const items = body.items.map((i) => {
          const p = data.products.find((p) => p.id === i.productId);
          if (!p) throw Error("Product unavailable");
          if (
            !Number.isInteger(i.quantity) ||
            i.quantity < 1 ||
            i.quantity > 1000
          )
            throw Error("সঠিক পণ্যের পরিমাণ দিন।");
          const detail = isBikeKeyring(p) ? keyringDetails(i) : {};
          return {
            ...i,
            ...detail,
            name: p.name,
            price: printPrice(p, detail.printSides),
            lineTotal: quantityPrice({ ...p, printSides: detail.printSides }, i.quantity),
          };
        });
        const totals = previewTotals(items, data, body.zone);
        const { quantity, subtotal, delivery } = totals;
        let orderId;
        do { orderId = 'CC-' + randomBytes(6).toString('hex').toUpperCase(); }
        while (data.orders.some(existing => existing.id === orderId));
        order = {
          ...body,
          id: orderId,
          items,
          quantity,
          product: items.map((i) => i.name).join(", "),
          subtotal,
          delivery,
          amount: totals.amount,
          discount: totals.discount,
          offer: totals.offer,
          nextUvDiscountPercent: totals.nextUvDiscountPercent,
          zone: body.zone || "dhaka",
          status: "Pending",
          date: new Date().toISOString(),
          payment: "Unpaid — payment not verified",
        };
        data.orders.push(order);
      }
      result = { id: order.id, amount: order.amount };
    } else throw Error("Preview action unavailable");
    return {
      ok: true,
      status: 200,
      json: async () => ({ result, state: data }),
    };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: error.message }),
    };
  }
}

export const seed = {
  products: previewSeed,
  categories: [...new Set(previewSeed.map((p) => p.category))],
  settings: previewDefaults,
  combos: [],
};
