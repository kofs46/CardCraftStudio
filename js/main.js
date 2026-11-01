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
const imageUrl = (src) => (src.startsWith("data:") ? src : src);

// Frontend preview only: no API requests, passwords or server authentication.
const previewSeed = [
  {
    id: "nid",
    name: "NID স্মার্ট কার্ড",
    category: "পরিচয়পত্র",
    description: "আপনার সরবরাহ করা বৈধ ডিজাইন থেকে পিভিসি কার্ড প্রিন্ট।",
    price: 100,
    images: ["images/demo-nid-front-v2.png", "images/demo-nid-back-v2.png"],
    imageSides: ["front", "back"],
    material: "PVC",
    size: "85.6 × 54 mm",
    available: true,
    featured: true,
  },
  {
    id: "license",
    name: "ড্রাইভিং লাইসেন্স কার্ড",
    category: "পরিচয়পত্র",
    description: "আপনার সরবরাহ করা ডিজাইন থেকে কার্ড প্রিন্ট।",
    price: 100,
    images: ["images/demo-license-front-v2.png", "images/demo-license-back-v2.png"],
    imageSides: ["front", "back"],
    material: "PVC",
    size: "85.6 × 54 mm",
    available: true,
    featured: false,
  },
  {
    id: "vaccine",
    name: "ভ্যাকসিন কার্ড",
    category: "সার্টিফিকেট",
    description: "সরবরাহ করা টিকা সনদের ডিজাইন থেকে কার্ড প্রিন্ট।",
    price: 100,
    images: ["images/demo-vaccine-front-v2.png", "images/demo-vaccine-back-v2.png"],
    imageSides: ["front", "back"],
    material: "PVC",
    size: "85.6 × 54 mm",
    available: true,
    featured: false,
  },
  {
    id: "student",
    name: "অফিস / স্টুডেন্ট আইডি",
    category: "অফিস ও শিক্ষা",
    description: "প্রতিষ্ঠান ও শিক্ষার্থীদের জন্য কাস্টম পরিচয়পত্র।",
    price: 100,
    images: ["images/demo-student-front-v2.png", "images/demo-student-back-v2.png"],
    imageSides: ["front", "back"],
    material: "PVC",
    size: "85.6 × 54 mm",
    available: true,
    featured: false,
  },
  {
    id: "custom",
    name: "কাস্টম ডিজাইন কার্ড",
    category: "কাস্টম কার্ড",
    description: "নিজস্ব ডিজাইন ও প্রয়োজন অনুযায়ী পিভিসি কার্ড।",
    price: 100,
    images: ["images/demo-business-front.png", "images/demo-business-back.png"],
    imageSides: ["front", "back"],
    material: "PVC",
    size: "85.6 × 54 mm",
    available: true,
    featured: false,
  },
];

const previewDefaults = {
  businessName: "",
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
  freeThreshold: 5,
};
function normalizePreview(data) {
  // Replace existing NID artwork once at the owner's request; preserve later uploads.
  const demoPairs = {
    nid: { legacy: [["images/sample-nid.svg"]], prefix: "nid", version: "-v2" },
    license: { legacy: [["images/sample-license.svg"]], prefix: "license", version: "-v2" },
    vaccine: { legacy: [["images/sample-vaccine.svg"]], prefix: "vaccine", version: "-v2" },
    student: { legacy: [["images/sample-student.svg"], ["images/demo-office-front.png", "images/demo-office-back.png"]], prefix: "student", version: "-v2" },
    custom: { legacy: [["images/hero-card.svg"]], prefix: "business", version: "" },
  };
  const products = (data.products || []).map((product) => {
    const isNid = product.id === "nid" || /\bNID\b|এনআইডি|জাতীয় পরিচয়পত্র|জাতীয় পরিচয়পত্র/i.test(product.name || "");
    if (isNid && data.nidDemoReplacementVersion !== 1) {
      return { ...product,
        images: ["images/demo-nid-front-v2.png", "images/demo-nid-back-v2.png"],
        imageSides: ["front", "back"],
      };
    }
    const demo = demoPairs[product.id];
    if (!demo || !demo.legacy.some((images) =>
      product.images?.length === images.length && images.every((src, i) => product.images[i] === src)
    )) return product;
    return { ...product,
      images: [`images/demo-${demo.prefix}-front${demo.version}.png`, `images/demo-${demo.prefix}-back${demo.version}.png`],
      imageSides: ["front", "back"],
    };
  });
  return {
    ...data,
    products,
    nidDemoReplacementVersion: 1,
    settings: {
      ...previewDefaults,
      ...data.settings,
      ...(data.businessContactsVersion === 1 ? {} : Object.fromEntries(
        ["phone", "phone2", "address", "email", "whatsapp", "facebook"].map((key) => [key, previewDefaults[key]])
      )),
    },
    businessContactsVersion: 1,
    combos: data.combos || [],
  };
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
  const rows = items.map((i) => ({
    ...i,
    product: data.products.find((p) => p.id === i.productId) || i,
  }));
  const quantity = rows.reduce((n, i) => n + i.quantity, 0),
    base = rows.reduce((n, i) => n + i.product.price * i.quantity, 0);
  let net = rows.reduce((n, i) => n + unitPrice(i.product) * i.quantity, 0),
    offer = "";
  for (const combo of data.combos.filter((c) => c.enabled)) {
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
  };
}

function previewRead() {
  try {
    const saved = localStorage.getItem("pvc_shop_frontend_v1");
    if (saved) {
      const previous = JSON.parse(saved);
      const normalized = normalizePreview(previous);
      if (previous.nidDemoReplacementVersion !== 1 || previous.businessContactsVersion !== 1) {
        try { localStorage.setItem("pvc_shop_frontend_v1", JSON.stringify(normalized)); } catch {}
      }
      return normalized;
    }
  } catch {}
  return {
    products: structuredClone(previewSeed),
    businessContactsVersion: 1,
    nidDemoReplacementVersion: 1,
    categories: [...new Set(previewSeed.map((p) => p.category))],
    orders: [],
    settings: { ...previewDefaults },
    combos: [],
  };
}
function previewSave(data) {
  try {
    localStorage.setItem("pvc_shop_frontend_v1", JSON.stringify(data));
  } catch {
    throw Error(
      "Browser storage is full or unavailable. Use smaller images or enable local storage.",
    );
  }
}
async function previewFetch(url, options = {}) {
  try {
    const route = url.replace("/api/", ""),
      method = options.method || "GET",
      body = options.body ? JSON.parse(options.body) : {},
      data = previewRead();
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
      previewSave(data);
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
          id: body.id || "combo-" + Date.now().toString(36),
        };
        data.combos = data.combos.some((c) => c.id === combo.id)
          ? data.combos.map((c) => (c.id === combo.id ? combo : c))
          : [...data.combos, combo];
      }
      previewSave(data);
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
      previewSave(data);
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
        const product = {
          ...body,
          id: body.id || "preview-" + Date.now().toString(36),
          finishes: ["Matte", "Gloss"],
          colors: ["#0f766e"],
          currency: "BDT",
        };
        data.products = data.products.some((p) => p.id === product.id)
          ? data.products.map((p) => (p.id === product.id ? product : p))
          : [...data.products, product];
        result.id = product.id;
      }
      previewSave(data);
    } else if (route === "orders") {
      data.orders = data.orders.map((o) =>
        o.id === body.id ? { ...o, status: body.status } : o,
      );
      previewSave(data);
    } else if (route === "order-artwork") {
      data.orders = data.orders.map((o) =>
        o.id === body.id
          ? { ...o, items: o.items.map((i) => ({ ...i, file: null })) }
          : o,
      );
      previewSave(data);
    } else if (route === "order-request") {
      let order = data.orders.find((o) => o.requestId === body.requestId);
      if (!order) {
        const items = body.items.map((i) => {
          const p = data.products.find((p) => p.id === i.productId);
          if (!p) throw Error("Product unavailable");
          return { ...i, name: p.name, price: p.price };
        });
        const totals = previewTotals(items, data, body.zone);
        const { quantity, subtotal, delivery } = totals;
        order = {
          ...body,
          id: "DEMO-" + Date.now().toString(36).toUpperCase(),
          items,
          quantity,
          product: items.map((i) => i.name).join(", "),
          subtotal,
          delivery,
          amount: totals.amount,
          discount: totals.discount,
          offer: totals.offer,
          zone: body.zone || "dhaka",
          status: "Pending",
          date: new Date().toISOString(),
          payment: "Frontend preview — no payment",
        };
        data.orders.push(order);
        previewSave(data);
      }
      result = { id: order.id, amount: order.amount };
    } else throw Error("Preview action unavailable");
    return { ok: true, status: 200, json: async () => result };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: error.message }),
    };
  }
}

if (document.body.classList.contains("admin-body")) {
  const app = document.querySelector("#app");

  const adminLabels = {
    Order: "অর্ডার",
    Customer: "গ্রাহক",
    Product: "পণ্য",
    Quantity: "পরিমাণ",
    Amount: "মোট",
    Status: "অবস্থা",
    Details: "বিস্তারিত",
    "View details": "বিস্তারিত দেখুন",
    "No records yet.": "এখনো কোনো তথ্য নেই।",
    Pending: "অপেক্ষমাণ",
    Processing: "প্রস্তুতি চলছে",
    Printing: "প্রিন্টিং",
    Completed: "সম্পন্ন",
    Cancelled: "বাতিল",
    "Add category": "ক্যাটাগরি যোগ করুন",
    "Category name": "ক্যাটাগরির নাম",
    Category: "ক্যাটাগরি",
    Products: "পণ্য",
    Actions: "করণীয়",
    Rename: "নাম বদলান",
    Delete: "মুছুন",
    Edit: "সম্পাদনা",
    "Add product": "পণ্য যোগ করুন",
    "Filter by category": "ক্যাটাগরি অনুযায়ী দেখুন",
    "All categories": "সব ক্যাটাগরি",
    Image: "ছবি",
    "Unit price": "প্রতি পিস মূল্য",
    Visibility: "প্রদর্শন",
    Visible: "দেখানো হচ্ছে",
    Hidden: "লুকানো",
    "Edit product": "পণ্য সম্পাদনা",
    "Product name": "পণ্যের নাম",
    "Unit price (BDT)": "প্রতি পিস মূল্য (টাকা)",
    "Discount type": "ছাড়ের ধরন",
    fixed: "টাকায়",
    percent: "শতাংশে",
    "Discount amount (BDT or %)": "ছাড়ের পরিমাণ (টাকা অথবা %)",
    Material: "উপাদান",
    Size: "আকার",
    "Visible in storefront": "ওয়েবসাইটে দেখান",
    "Featured product": "বিশেষ পণ্য",
    "Save product": "পণ্য সংরক্ষণ",
    Cancel: "বাতিল",
    Remove: "সরান",
    "Set cover": "প্রচ্ছদ করুন",
    Cover: "প্রচ্ছদ",
    "Multiple images (up to 6; PNG, JPEG, WebP; 2 MB each)":
      "একাধিক ছবি (সর্বোচ্চ ৬টি, প্রতি ছবি ২ এমবি)",
    "The first image is the cover. Remove old images before replacing them.":
      "প্রথম ছবিটি প্রচ্ছদ। চাইলে ছবি সরাতে বা প্রচ্ছদ বদলাতে পারবেন।",
    "Add combo offer": "কম্বো অফার যোগ করুন",
    Offer: "অফার",
    "Combo price": "কম্বোর মূল্য",
    Enabled: "চালু",
    "Add combo": "কম্বো যোগ করুন",
    "Edit combo": "কম্বো সম্পাদনা",
    "Offer name": "অফারের নাম",
    "Offer details": "অফারের বিবরণ",
    "Total combo price (BDT)": "কম্বোর মোট মূল্য (টাকা)",
    "Products in this combo": "কম্বোর অন্তর্ভুক্ত পণ্য",
    "Set quantity to zero to exclude a product.":
      "যে পণ্যটি রাখবেন না, তার পরিমাণ শূন্য রাখুন।",
    "Enable offer": "অফার চালু রাখুন",
    "Save combo": "কম্বো সংরক্ষণ",
    "Delivery charges": "ডেলিভারি চার্জ",
    "Charge delivery fees": "ডেলিভারি চার্জ প্রযোজ্য",
    "Inside Dhaka fee (BDT)": "ঢাকার ভিতরে চার্জ (টাকা)",
    "Outside Dhaka fee (BDT)": "ঢাকার বাইরে চার্জ (টাকা)",
    "Free delivery from this many pieces (0 = disabled)":
      "কত পিস থেকে ফ্রি ডেলিভারি (০ দিলে বন্ধ)",
    "Save delivery settings": "ডেলিভারি সেটিংস সংরক্ষণ",
    "Business and contact details": "ব্যবসা ও যোগাযোগের তথ্য",
    "Business name": "ব্যবসার নাম",
    "Contact number": "যোগাযোগের নম্বর",
    Email: "ইমেইল",
    "WhatsApp number (01… or 8801…)": "হোয়াটসঅ্যাপ নম্বর (01… অথবা 8801…)",
    "Payment contact numbers": "পেমেন্টের নম্বর",
    "bKash number": "বিকাশ নম্বর",
    "Nagad number": "নগদ নম্বর",
    "Social media": "সামাজিক যোগাযোগমাধ্যম",
    "Save business details": "ব্যবসার তথ্য সংরক্ষণ",
    "Search orders": "অর্ডার খুঁজুন",
    "Search customers": "গ্রাহক খুঁজুন",
    Contact: "যোগাযোগ",
    Address: "ঠিকানা",
    "Orders / value": "অর্ডার / মূল্য",
    History: "ইতিহাস",
    "After discount:": "ছাড়ের পর:",
    "No file": "ফাইল নেই",
    "Remove retained artwork": "সংরক্ষিত ফাইল সরান",
    "One best matching combo is applied automatically. Combo pricing replaces product discounts for bundled pieces; remaining pieces keep their product discounts.":
      "সবচেয়ে সাশ্রয়ী একটি কম্বো স্বয়ংক্রিয়ভাবে প্রযোজ্য। কম্বোর পণ্যগুলোর জন্য কম্বোর মূল্য, বাকি পণ্যে নিয়মিত ছাড় প্রযোজ্য।",
    "These are display details only. No money or payment verification is handled by this frontend.":
      "এগুলো শুধু দেখানোর তথ্য। এখানে টাকা গ্রহণ বা পেমেন্ট যাচাই করা হয় না।",
    "Customers from demo orders in this browser appear here. This frontend preview does not protect customer data.":
      "এই ব্রাউজারের ডেমো অর্ডারের গ্রাহকদের তথ্য এখানে দেখা যাবে। প্রকৃত ব্যক্তিগত তথ্য ব্যবহার করবেন না।",
  };
  function localizeAdmin() {
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest("script,style,textarea")) continue;
      const value = node.textContent.trim();
      if (adminLabels[value])
        node.textContent = node.textContent.replace(value, adminLabels[value]);
    }
    app.querySelectorAll("input[placeholder]").forEach((input) => {
      if (input.id === "order-search")
        input.placeholder = "নাম, ফোন বা অর্ডার নম্বর";
      if (input.id === "customer-search")
        input.placeholder = "নাম, ইমেইল বা ফোন";
    });
  }

  let data,
    images = [],
    imageSides = [];
  const page = new URLSearchParams(location.search).get("view") || "login";
  const loginPage = ["index", "login"].includes(page);
  const statuses = [
    "Pending",
    "Processing",
    "Printing",
    "Completed",
    "Cancelled",
  ];
  async function api(route, method = "GET", body) {
    const response = await previewFetch(`/api/${route}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !loginPage) location.replace("admin.html");
      throw Error(result.error || "Request failed");
    }
    return result;
  }
  const options = (values, current) =>
    values
      .map(
        (v) =>
          `<option value="${e(v)}" ${v === current ? "selected" : ""}>${e(v)}</option>`,
      )
      .join("");
  const field = (label, name, value = "", type = "text", extra = "") =>
    `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
  function message(value) {
    const el = document.querySelector("#live-message");
    el.textContent = value;
    el.focus();
  }
  async function reload() {
    data = await api("admin");
    render();
    localizeAdmin();
  }
  function table(headers, rows) {
    return `<div class="table-scroll table-container"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">No records yet.</td></tr>`}</tbody></table></div>`;
  }
  function dashboard() {
    const cards = [
      ["মোট অর্ডার", data.orders.length, "blue", "▤"],
      [
        "অপেক্ষমাণ",
        data.orders.filter((o) => o.status === "Pending").length,
        "amber",
        "◷",
      ],
      [
        "প্রিন্টিং চলছে",
        data.orders.filter(
          (o) => o.status === "Printing" || o.status === "Processing",
        ).length,
        "teal",
        "▣",
      ],
      [
        "সম্পন্ন অর্ডারের মূল্য",
        money(
          data.orders
            .filter((o) => o.status === "Completed")
            .reduce((n, o) => n + o.amount - (o.delivery || 0), 0),
        ),
        "green",
        "৳",
      ],
    ];
    return (
      '<div class="admin-stats-grid">' +
      cards
        .map(
          ([label, value, color, icon]) =>
            '<div class="stat-card"><div class="stat-card__icon stat-card__icon--' +
            color +
            '">' +
            icon +
            '</div><div><div class="stat-card__num">' +
            e(value) +
            '</div><div class="stat-card__label">' +
            label +
            "</div></div></div>",
        )
        .join("") +
      '</div><div class="admin-toolbar"><label class="admin-search-box">অর্ডার খুঁজুন<input id="overview-search" class="form-control" placeholder="নাম, ফোন বা অর্ডার নম্বর"></label><label>অবস্থা<select id="overview-status" class="form-control"><option value="">সব অর্ডার</option>' +
      options(statuses) +
      '</select></label></div><div id="overview-orders">' +
      orderTable(data.orders.slice().reverse()) +
      "</div>"
    );
  }
  function orderTable(orders) {
    return table(
      [
        "Order",
        "Customer",
        "Product",
        "Quantity",
        "Amount",
        "Status",
        "Details",
      ],
      orders.map(
        (o) =>
          `<tr><td>${e(o.id)}</td><td>${e(o.customer)}<br>${e(o.phone)}</td><td>${e(o.product)}</td><td>${e(o.quantity)}</td><td>${money(o.amount)}</td><td><select aria-label="Order status ${e(o.id)}" data-status="${e(o.id)}">${options(statuses, o.status)}</select></td><td><button data-order="${e(o.id)}">View details</button></td></tr>`,
      ),
    );
  }
  function render() {
    const names = {
      dashboard: "Business dashboard",
      analytics: "Business dashboard",
      categories: "Categories",
      products: "Products & discounts",
      customers: "Customer details",
      orders: "Orders",
      combos: "Combo offers",
      delivery: "Delivery fees",
      business: "Business & social",
    };
    const labels = {
      dashboard: "অর্ডার ম্যানেজমেন্ট",
      categories: "ক্যাটাগরি",
      products: "পণ্য ও ছাড়",
      combos: "কম্বো অফার",
      delivery: "ডেলিভারি চার্জ",
      business: "ব্যবসার তথ্য",
      orders: "সকল অর্ডার",
      customers: "গ্রাহকের তথ্য",
      images: "কার্ডের ছবি",
    };
    app.innerHTML = `<header class="admin-navbar"><div class="container admin-navbar__inner"><a class="original-admin-brand" href="admin.html?view=dashboard">কার্ড পয়েন্ট বিডি <span>| অ্যাডমিন প্যানেল</span></a><div class="original-header-actions"><a href="index.html">ওয়েবসাইট দেখুন</a><button id="logout" type="button">লগআউট</button></div></div></header><main id="main" class="container live-admin original-admin"><div class="original-admin-heading"><h1>${labels[page] || "অ্যাডমিন প্যানেল"}</h1><p>ফ্রন্টএন্ড ডেমো · তথ্য শুধু এই ব্রাউজারে থাকে</p></div><nav class="admin-toolbar admin-section-tabs" aria-label="অ্যাডমিন অপশন">${Object.entries(
      labels,
    )
      .map(
        ([key, label]) =>
          '<a class="filter-pill ' +
          (page === key ? "active" : "") +
          '" href="admin.html?view=' +
          key +
          '">' +
          label +
          "</a>",
      )
      .join(
        "",
      )}</nav><p id="live-message" role="status" tabindex="-1"></p><section id="workspace"></section></main>`;
    const workspace = document.querySelector("#workspace");
    if (page === "categories")
      workspace.innerHTML = `<form id="category-form" class="admin-panel">${field("Category name", "name", "", "text", 'required maxlength="100"')}<button class="btn btn-primary">Add category</button></form>${table(
        ["Category", "Products", "Actions"],
        data.categories.map(
          (c) =>
            `<tr><td>${e(c)}</td><td>${data.products.filter((p) => p.category === c).length}</td><td><button data-rename="${e(c)}">Rename</button> <button data-delete-category="${e(c)}">Delete</button></td></tr>`,
        ),
      )}`;
    else if (page === "products" || page === "images")
      workspace.innerHTML = `<button id="add-product" class="btn btn-primary">Add product</button><label>Filter by category<select id="category-filter"><option value="">All categories</option>${options(data.categories)}</select></label><section id="product-list"></section><div id="product-editor"></div>`;
    else if (page === "orders")
      workspace.innerHTML = `<label>Search orders<input id="order-search" placeholder="Name, phone or order ID"></label><div id="order-list">${orderTable(data.orders)}</div>`;
    else if (page === "customers")
      workspace.innerHTML = `<label>Search customers<input id="customer-search" placeholder="Name, email or phone"></label><div id="customer-list"></div><p>Customers from demo orders in this browser appear here. This frontend preview does not protect customer data.</p>`;
    else if (page === "combos") workspace.innerHTML = comboPage();
    else if (page === "delivery" || page === "business")
      workspace.innerHTML = settingsPage();
    else if (["dashboard", "analytics"].includes(page))
      workspace.innerHTML = dashboard();
    else
      workspace.innerHTML =
        "<p>Use the navigation to manage your business. Real account management will be added with the backend.</p>";
    wire();
  }
  function listProducts(category = "") {
    document.querySelector("#product-list").innerHTML = table(
      ["Image", "Product", "Category", "Unit price", "Visibility", "Actions"],
      data.products
        .filter((p) => !category || p.category === category)
        .map(
          (p) =>
            `<tr><td><img width="80" height="55" style="object-fit:contain" alt="${e(p.name)}" src="${e(p.images[0].startsWith("data:") ? p.images[0] : p.images[0])}"></td><td>${e(p.name)}<br><small>${p.images.map((_, i) => sideLabel(imageSide(p, i))).join(" · ")}</small></td><td>${e(p.category)}</td><td>${money(p.price)}${unitPrice(p) < p.price ? `<br><strong>After discount: ${money(unitPrice(p))}</strong>` : ""}</td><td>${p.available ? "Visible" : "Hidden"}</td><td><button data-edit="${e(p.id)}">Edit</button> <button data-delete="${e(p.id)}">Delete</button></td></tr>`,
        ),
    );
    document
      .querySelectorAll("[data-edit]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editor(data.products.find((p) => p.id === b.dataset.edit))),
      );
    document.querySelectorAll("[data-delete]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            if (confirm("Delete this product?")) {
              await api("products", "DELETE", { id: b.dataset.delete });
              await reload();
            }
          })),
    );
  }
  function editor(p = { available: true, images: [] }) {
    images = [...p.images];
    imageSides = images.map((_, i) => imageSide(p, i));
    document.querySelector("#product-editor").innerHTML =
      `<form id="product-form" class="admin-panel"><h2>${p.id ? "Edit" : "Add"} product</h2>${field("Product name", "name", p.name, "text", 'required maxlength="200"')}<label>Category<select name="category" required>${options(data.categories, p.category)}</select></label>${field("Unit price (BDT)", "price", p.price ?? 0, "number", 'required min="0" max="10000000" step="0.01"')}<label>Discount type<select name="discountType">${options(["fixed", "percent"], p.discountType || "fixed")}</select></label>${field("Discount amount (BDT or %)", "discount", p.discount || 0, "number", 'min="0" step="0.01" required')}<label>Details<textarea name="description" maxlength="5000">${e(p.description)}</textarea></label>${field("Material", "material", p.material || "PVC")}${field("Size", "size", p.size)}<label><input name="available" type="checkbox" ${p.available ? "checked" : ""}> Visible in storefront</label><label><input name="featured" type="checkbox" ${p.featured ? "checked" : ""}> Featured product</label><h3>কার্ডের সামনের ও পেছনের ছবি</h3><div class="card-side-uploads"><label>সামনের দিকের ছবি<input id="product-front-image" type="file" accept="image/png,image/jpeg,image/webp"></label><label>পেছনের দিকের ছবি<input id="product-back-image" type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>Multiple images (up to 6; PNG, JPEG, WebP; 2 MB each)<input id="product-images" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><p>The first image is the cover. Remove old images before replacing them.</p><div id="image-previews" class="live-images"></div><p id="image-error" role="alert"></p><button class="btn btn-primary" id="save-product">Save product</button><button class="btn btn-secondary" id="cancel-product" type="button">Cancel</button></form>`;
    const previews = () => {
      document.querySelector("#image-previews").innerHTML = images
        .map(
          (src, i) =>
            `<figure><img width="120" height="90" style="object-fit:contain" alt="Product image ${i + 1}" src="${e(src.startsWith("data:") ? src : src)}"><figcaption><strong>${sideLabel(imageSides[i])}</strong><select data-image-side="${i}" aria-label="ছবির দিক">${["front", "back", "extra"].map((side) => `<option value="${side}" ${imageSides[i] === side ? "selected" : ""}>${sideLabel(side)}</option>`).join("")}</select>${i === 0 ? "Cover" : `Image ${i + 1}`} <button type="button" data-remove="${i}">Remove</button>${i ? ` <button type="button" data-cover="${i}">Set cover</button>` : ""}</figcaption></figure>`,
        )
        .join("");
      document.querySelectorAll("[data-image-side]").forEach(
        (select) =>
          (select.onchange = () => {
            const i = Number(select.dataset.imageSide),
              side = select.value;
            if (side !== "extra")
              imageSides = imageSides.map((value, index) =>
                index !== i && value === side ? "extra" : value,
              );
            imageSides[i] = side;
            previews();
          }),
      );
      document.querySelectorAll("[data-remove]").forEach(
        (b) =>
          (b.onclick = () => {
            images.splice(Number(b.dataset.remove), 1);
            imageSides.splice(Number(b.dataset.remove), 1);
            previews();
          }),
      );
      document.querySelectorAll("[data-cover]").forEach(
        (b) =>
          (b.onclick = () => {
            images.unshift(images.splice(Number(b.dataset.cover), 1)[0]);
            imageSides.unshift(
              imageSides.splice(Number(b.dataset.cover), 1)[0],
            );
            previews();
          }),
      );
    };
    previews();
    document.querySelector("#cancel-product").onclick = () =>
      document.querySelector("#product-editor").replaceChildren();

    for (const side of ["front", "back"])
      document.querySelector("#product-" + side + "-image").onchange = async (
        ev,
      ) => {
        const file = ev.target.files[0];
        if (!file) return;
        const save = document.querySelector("#save-product");
        save.disabled = true;
        try {
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 2 * 1024 * 1024
          )
            throw Error("সর্বোচ্চ ২ এমবি আকারের PNG, JPEG বা WebP ছবি দিন।");
          const index = imageSides.indexOf(side);
          if (index < 0 && images.length >= 6)
            throw Error("সর্বোচ্চ ৬টি ছবি রাখা যাবে।");
          const src = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(Error("ছবি পড়া যায়নি।"));
            reader.readAsDataURL(file);
          });
          const img = new Image();
          img.src = src;
          await img.decode();
          if (index >= 0) images[index] = src;
          else {
            images.push(src);
            imageSides.push(side);
          }
          previews();
          document.querySelector("#image-error").textContent = "";
        } catch (error) {
          document.querySelector("#image-error").textContent = error.message;
        } finally {
          save.disabled = false;
          ev.target.value = "";
        }
      };

    document.querySelector("#product-images").onchange = async (ev) => {
      const save = document.querySelector("#save-product");
      save.disabled = true;
      try {
        const files = [...ev.target.files];
        if (images.length + files.length > 6) throw Error("Maximum 6 images.");
        const additions = [];
        for (const file of files) {
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 2 * 1024 * 1024
          )
            throw Error("Choose PNG, JPEG or WebP images up to 2 MB.");
          const src = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(Error("Image could not be read."));
            r.readAsDataURL(file);
          });
          const img = new Image();
          img.src = src;
          await img.decode();
          additions.push(src);
        }
        additions.forEach((src) => {
          images.push(src);
          imageSides.push(
            !imageSides.includes("front")
              ? "front"
              : !imageSides.includes("back")
                ? "back"
                : "extra",
          );
        });
        previews();
        document.querySelector("#image-error").textContent = "";
      } catch (error) {
        document.querySelector("#image-error").textContent = error.message;
      } finally {
        save.disabled = false;
        ev.target.value = "";
      }
    };
    document.querySelector("#product-form").onsubmit = (ev) => {
      ev.preventDefault();
      run(async () => {
        const f = new FormData(ev.target);
        await api("products", "POST", {
          id: p.id,
          name: f.get("name"),
          category: f.get("category"),
          price: Number(f.get("price")),
          discountType: f.get("discountType"),
          discount: Number(f.get("discount")),
          description: f.get("description"),
          material: f.get("material"),
          size: f.get("size"),
          available: f.has("available"),
          featured: f.has("featured"),
          images,
          imageSides,
        });
        await reload();
        message("Product saved.");
      });
    };
    localizeAdmin();
    document.querySelector("#product-form input").focus();
  }
  async function run(action) {
    try {
      await action();
    } catch (error) {
      message(error.message);
    }
  }
  function customers(query = "") {
    const groups = new Map();
    for (const o of data.orders) {
      const key = o.phone || o.email;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    document.querySelector("#customer-list").innerHTML = table(
      ["Customer", "Contact", "Address", "Orders / value", "History"],
      [...groups.values()]
        .filter((orders) =>
          JSON.stringify(orders).toLowerCase().includes(query.toLowerCase()),
        )
        .map((orders) => {
          const o = orders.at(-1);
          return `<tr><td>${e(o.customer)}</td><td>${e(o.phone)}<br>${e(o.email)}</td><td>${e(o.location)}</td><td>${orders.length} / ${money(orders.filter((x) => x.status !== "Cancelled").reduce((n, x) => n + x.amount, 0))}</td><td>${orders.map((x) => `${e(x.id)} · ${e(x.product)} · ${e(x.status)}`).join("<br>")}</td></tr>`;
        }),
    );
  }
  function comboPage() {
    return `<button id="add-combo" class="btn btn-primary">Add combo offer</button><p>One best matching combo is applied automatically. Combo pricing replaces product discounts for bundled pieces; remaining pieces keep their product discounts.</p>${table(
      ["Offer", "Products", "Combo price", "Visibility", "Actions"],
      data.combos.map(
        (c) =>
          `<tr><td>${e(c.name)}<br>${e(c.details)}</td><td>${c.items.map((i) => `${e(data.products.find((p) => p.id === i.productId)?.name || "Deleted product")} × ${i.quantity}`).join("<br>")}</td><td>${money(c.price)}</td><td>${c.enabled ? "Enabled" : "Hidden"}</td><td><button data-edit-combo="${e(c.id)}">Edit</button> <button data-delete-combo="${e(c.id)}">Delete</button></td></tr>`,
      ),
    )}<div id="combo-editor"></div>`;
  }
  function comboEditor(combo = { items: [], enabled: true }) {
    document.querySelector("#combo-editor").innerHTML =
      `<form id="combo-form" class="admin-panel"><h2>${combo.id ? "Edit" : "Add"} combo</h2>${field("Offer name", "name", combo.name || "", "text", 'required maxlength="150"')}<label>Offer details<textarea name="details" maxlength="1000">${e(combo.details)}</textarea></label>${field("Total combo price (BDT)", "price", combo.price || 0, "number", 'required min="0" step="0.01"')}<h3>Products in this combo</h3><p>Set quantity to zero to exclude a product.</p>${data.products.map((p) => `<label>${e(p.name)} (${money(p.price)} each)<input type="number" min="0" max="1000" step="1" data-combo-product="${e(p.id)}" value="${combo.items.find((i) => i.productId === p.id)?.quantity || 0}"></label>`).join("")}<label><input type="checkbox" name="enabled" ${combo.enabled ? "checked" : ""}> Enable offer</label><button class="btn btn-primary">Save combo</button><button type="button" id="cancel-combo" class="btn btn-secondary">Cancel</button></form>`;
    localizeAdmin();
    document.querySelector("#cancel-combo").onclick = () =>
      document.querySelector("#combo-editor").replaceChildren();
    document.querySelector("#combo-form").onsubmit = (ev) => {
      ev.preventDefault();
      run(async () => {
        const f = new FormData(ev.target),
          items = [...ev.target.querySelectorAll("[data-combo-product]")]
            .map((input) => ({
              productId: input.dataset.comboProduct,
              quantity: Number(input.value),
            }))
            .filter((i) => i.quantity > 0);
        await api("combos", "POST", {
          id: combo.id,
          name: f.get("name"),
          details: f.get("details"),
          price: Number(f.get("price")),
          items,
          enabled: f.has("enabled"),
        });
        await reload();
        message("Combo saved.");
      });
    };
  }
  function settingsPage() {
    const settings = data.settings;
    if (page === "delivery")
      return `<form id="settings-form" class="admin-panel"><h2>Delivery charges</h2><label><input name="deliveryEnabled" type="checkbox" ${settings.deliveryEnabled ? "checked" : ""}> Charge delivery fees</label>${field("Inside Dhaka fee (BDT)", "dhakaFee", settings.dhakaFee, "number", 'required min="0" max="100000" step="0.01"')}${field("Outside Dhaka fee (BDT)", "outsideFee", settings.outsideFee, "number", 'required min="0" max="100000" step="0.01"')}${field("Free delivery from this many pieces (0 = disabled)", "freeThreshold", settings.freeThreshold, "number", 'required min="0" max="100000" step="1"')}<button class="btn btn-primary">Save delivery settings</button></form>`;
    return `<form id="settings-form" class="admin-panel"><h2>Business and contact details</h2>${field("Business name", "businessName", settings.businessName)}${field("Contact number", "phone", settings.phone, "tel")}${field("দ্বিতীয় যোগাযোগ নম্বর", "phone2", settings.phone2, "tel")}<label>ব্যবসার ঠিকানা<textarea name="address" maxlength="500">${e(settings.address)}</textarea></label>${field("Email", "email", settings.email, "email")}${field("WhatsApp number (01… or 8801…)", "whatsapp", settings.whatsapp, "tel")}<h3>Payment contact numbers</h3><p>These are display details only. No money or payment verification is handled by this frontend.</p>${field("bKash number", "bkash", settings.bkash, "tel")}${field("Nagad number", "nagad", settings.nagad, "tel")}<h3>Social media</h3>${["facebook", "instagram", "youtube", "tiktok"].map((key) => field(key[0].toUpperCase() + key.slice(1) + " URL", key, settings[key], "url", 'placeholder="https://…"')).join("")}<button class="btn btn-primary">Save business details</button></form>`;
  }
  function wireManagement() {
    document
      .querySelector("#add-combo")
      ?.addEventListener("click", () => comboEditor());
    document
      .querySelectorAll("[data-edit-combo]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            comboEditor(
              data.combos.find((c) => c.id === button.dataset.editCombo),
            )),
      );
    document.querySelectorAll("[data-delete-combo]").forEach(
      (button) =>
        (button.onclick = () =>
          run(async () => {
            if (confirm("Delete this combo offer?")) {
              await api("combos", "DELETE", { id: button.dataset.deleteCombo });
              await reload();
            }
          })),
    );
    document
      .querySelector("#settings-form")
      ?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        run(async () => {
          const f = new FormData(ev.target),
            body = Object.fromEntries(f);
          if (page === "delivery") {
            body.deliveryEnabled = f.has("deliveryEnabled");
            for (const key of ["dhakaFee", "outsideFee", "freeThreshold"])
              body[key] = Number(f.get(key));
          }
          await api("settings", "POST", body);
          await reload();
          message("Settings saved. Reload the storefront to see updates.");
        });
      });
  }

  function wire() {
    wireManagement();
    const filterOverview = () => {
      const q = document.querySelector("#overview-search").value.toLowerCase(),
        status = document.querySelector("#overview-status").value;
      document.querySelector("#overview-orders").innerHTML = orderTable(
        data.orders
          .filter(
            (o) =>
              (!status || o.status === status) &&
              `${o.customer} ${o.phone} ${o.id}`.toLowerCase().includes(q),
          )
          .reverse(),
      );
      localizeAdmin();
    };
    document
      .querySelector("#overview-search")
      ?.addEventListener("input", filterOverview);
    document
      .querySelector("#overview-status")
      ?.addEventListener("change", filterOverview);
    document.querySelector("#workspace").onclick = (ev) => {
      const id = ev.target.closest("[data-order]")?.dataset.order;
      if (!id) return;
      const order = data.orders.find((o) => o.id === id);
      const dialog = document.querySelector("#modal");
      document.querySelector("#modal-content").innerHTML =
        `<h2>${e(order.id)}</h2><p>${e(order.customer)} · ${e(order.phone)} · ${e(order.email)}</p><p>${e(order.location)}</p><p>${e(order.date)}</p><h3>Design requirements</h3><p style="white-space:pre-wrap">${e(order.requirements)}</p>${table(
          ["Product", "Quantity", "Unit price", "Artwork"],
          order.items.map(
            (item) =>
              `<tr><td>${e(item.name)}</td><td>${item.quantity}</td><td>${money(item.price)}</td><td>${item.file ? `<a download="${e(item.file.name)}" href="${e(item.file.data)}">Download ${e(item.file.name)}</a>` : "No file"}</td></tr>`,
          ),
        )}<p>Subtotal: ${money(order.subtotal)} · Discount: ${money(order.discount || 0)} ${e(order.offer || "")} · Delivery area: ${order.zone === "outside" ? "Outside Dhaka" : "Inside Dhaka"} · Delivery: ${money(order.delivery)} · Total: ${money(order.amount)}</p><p>${e(order.payment)}</p><button id="wipe-artwork">Remove retained artwork</button>`;
      document.querySelector("#wipe-artwork").onclick = () =>
        run(async () => {
          if (
            !confirm(
              "Permanently remove artwork from this order? Keep a copy if needed.",
            )
          )
            return;
          await api("order-artwork", "DELETE", { id: order.id });
          dialog.close();
          await reload();
          message("Artwork removed.");
        });
      dialog.querySelector(".close").onclick = () => dialog.close();
      dialog.showModal();
    };
    document.querySelector("#logout").onclick = () =>
      run(async () => {
        await api("logout", "POST", {});
        location.replace("admin.html");
      });
    document
      .querySelector("#category-form")
      ?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        run(async () => {
          await api("categories", "POST", {
            name: new FormData(ev.target).get("name"),
          });
          await reload();
        });
      });
    document.querySelectorAll("[data-rename]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            const name = prompt("New category name", b.dataset.rename);
            if (name) {
              await api("categories", "POST", {
                previous: b.dataset.rename,
                name,
              });
              await reload();
            }
          })),
    );
    document.querySelectorAll("[data-delete-category]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            if (confirm("Delete this empty category?")) {
              await api("categories", "DELETE", {
                name: b.dataset.deleteCategory,
              });
              await reload();
            }
          })),
    );
    if (page === "products" || page === "images") {
      listProducts();
      document.querySelector("#add-product").onclick = () => editor();
      document.querySelector("#category-filter").onchange = (ev) =>
        listProducts(ev.target.value);
    }
    if (page === "customers") {
      customers();
      document.querySelector("#customer-search").oninput = (ev) =>
        customers(ev.target.value);
    }
    document.querySelector("#order-search")?.addEventListener("input", (ev) => {
      document.querySelector("#order-list").innerHTML = orderTable(
        data.orders.filter((o) =>
          `${o.customer} ${o.phone} ${o.id}`
            .toLowerCase()
            .includes(ev.target.value.toLowerCase()),
        ),
      );
    });
    document.querySelector("#workspace").onchange = (ev) => {
      if (ev.target.dataset.status)
        run(async () => {
          await api("orders", "PATCH", {
            id: ev.target.dataset.status,
            status: ev.target.value,
          });
          await reload();
        });
    };
  }
  async function start() {
    if (!loginPage) return reload();
    const auth = await api("auth");
    app.innerHTML = `<div id="adminLoginGate"><main id="main" class="login-card"><h1>অ্যাডমিন প্যানেল</h1><p>কার্ড পয়েন্ট বিডি</p><p id="live-message" role="alert" tabindex="-1"></p><form id="sign-in"><button class="btn btn--primary btn--block">ডেমো প্যানেলে প্রবেশ করুন</button></form><small>এটি ফ্রন্টএন্ড প্রিভিউ। কোনো প্রকৃত পাসওয়ার্ড প্রয়োজন নেই।</small><p><a href="index.html">ওয়েবসাইটে ফিরে যান</a></p></main></div>`;
    document.querySelector("#sign-in").onsubmit = async (ev) => {
      ev.preventDefault();
      const button = ev.target.querySelector("button");
      button.disabled = true;
      const f = new FormData(ev.target);
      await run(async () => {
        await api("login", "POST", {
          email: f.get("email"),
          password: f.get("password"),
        });
        location.replace("admin.html?view=dashboard");
      });
      button.disabled = false;
    };
  }
  start().catch((error) => {
    app.innerHTML =
      '<main class="live-login"><h1>Admin unavailable</h1><p id="live-message" role="alert" tabindex="-1"></p><p>Refresh this page to restart the frontend preview.</p></main>';
    message(error.message);
  });
} else {
  const $ = (selector) => document.querySelector(selector);
  function applyBusiness() {
    const settings = previewRead().settings;
    const phoneHref = (value) => "tel:" + digits(value).replace(/[^+0-9]/g, "");
    if (settings.businessName)
      document
        .querySelectorAll(".footer__brand-title")
        .forEach((el) => (el.textContent = settings.businessName));
    document.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      if (!a.dataset.contactSlot) {
        const links = [
          ...(a
            .closest(".footer__contact-list")
            ?.querySelectorAll('a[href^="tel:"]') || []),
        ];
        a.dataset.contactSlot = links.indexOf(a) > 0 ? "secondary" : "primary";
      }
      const value =
        a.dataset.contactSlot === "secondary"
          ? settings.phone2 || settings.phone
          : settings.phone;
      if (value) {
        a.href = phoneHref(value);
        a.textContent = value;
      }
    });
    if (settings.email)
      document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
        a.href = "mailto:" + settings.email;
        a.textContent = settings.email;
      });
    if (settings.address)
      document.querySelectorAll(".footer__contact-list").forEach((list) => {
        const item = list.querySelector(".footer__contact-item");
        const text = item?.querySelector("span:last-child");
        if (text) text.textContent = settings.address;
      });
    document.querySelectorAll("p>strong").forEach((label) => {
      const title = label.textContent;
      let value;
      if (/ঠিকানা|অফিস:/.test(title)) value = settings.address;
      else if (/হেল্পলাইন|ফোন|মোবাইল/.test(title))
        value = [settings.phone, settings.phone2].filter(Boolean).join(", ");
      else if (/ইমেইল/.test(title)) value = settings.email;
      else if (/প্রতিষ্ঠানের নাম/.test(title)) value = settings.businessName;
      if (value) {
        const p = label.parentElement;
        if (/ইমেইল/.test(title)) {
          const link = document.createElement("a");
          link.href = "mailto:" + value;
          link.textContent = value;
          p.replaceChildren(label, document.createTextNode(" "), link);
        } else if (/হেল্পলাইন|ফোন|মোবাইল/.test(title) && !settings.phone2) {
          const link = document.createElement("a");
          link.href = phoneHref(settings.phone);
          link.textContent = value;
          p.replaceChildren(label, document.createTextNode(" "), link);
        } else {
          p.replaceChildren(label, document.createTextNode(" " + value));
        }
      }
    });
    if (settings.whatsapp) {
      let phone = digits(settings.whatsapp).replace(/\D/g, "");
      if (phone.startsWith("01")) phone = "88" + phone;
      document
        .querySelectorAll('a[href*="wa.me/"],a[data-business-whatsapp]')
        .forEach((a) => {
          a.dataset.businessWhatsapp = "true";
          const old = new URL(a.href, location.href);
          a.href = "https://wa.me/" + phone + old.search;
        });
    }
    for (const key of ["facebook", "instagram", "youtube", "tiktok"]) {
      document
        .querySelectorAll(
          'a[href*="' + key + '.com"],a[data-business-social="' + key + '"]',
        )
        .forEach((a) => {
          a.dataset.businessSocial = key;
          if (settings[key]) a.href = settings[key];
        });
    }
    const footer = document.querySelector(".footer");
    if (footer) {
      let links = footer.querySelector(".shop-socials");
      if (!links) {
        links = document.createElement("div");
        links.className = "shop-socials container";
        footer.append(links);
      }
      links.innerHTML = ["facebook", "instagram", "youtube", "tiktok"]
        .filter((key) => settings[key] && /^https?:\/\//i.test(settings[key]))
        .map(
          (key) =>
            '<a target="_blank" rel="noopener noreferrer" href="' +
            e(settings[key]) +
            '">' +
            key[0].toUpperCase() +
            key.slice(1) +
            "</a>",
        )
        .join("");
    }
  }
  window.addEventListener("storage", (event) => {
    if (event.key === "pvc_shop_frontend_v1") applyBusiness();
  });
  function applyPublicPricing() {
    const data = previewRead(),
      settings = data.settings,
      combo = data.combos.find(
        (c) =>
          c.enabled &&
          c.items.every((i) =>
            data.products.some((p) => p.id === i.productId && p.available),
          ),
      );
    const deliveryText = !settings.deliveryEnabled
      ? "ডেলিভারি চার্জ নেই।"
      : settings.freeThreshold > 0
        ? new Intl.NumberFormat("bn-BD").format(settings.freeThreshold) +
          " পিস থেকে ফ্রি ডেলিভারি।"
        : "ঢাকায় " +
          money(settings.dhakaFee) +
          " · ঢাকার বাইরে " +
          money(settings.outsideFee);
    document
      .querySelectorAll(".free-delivery-banner__text")
      .forEach((el) => (el.textContent = deliveryText));
    const regular = document.querySelector(
      ".pricing-card:not(.pricing-card--featured)",
    );
    if (regular) {
      const prices = data.products.filter((p) => p.available).map(unitPrice);
      regular.querySelector(".pricing-card__amount").textContent = prices.length
        ? money(Math.min(...prices))
        : "—";
      regular.querySelector(".pricing-card__unit").textContent = "/ পিস থেকে";
      const item = regular.querySelector(
        ".pricing-card__item:last-child span:last-child",
      );
      if (item) item.textContent = deliveryText;
    }
    const featured = document.querySelector(".pricing-card--featured");
    if (featured) {
      featured.querySelector(".pricing-card__title").textContent = combo
        ? combo.name
        : "ডেলিভারি তথ্য";
      featured.querySelector(".pricing-card__amount").textContent = combo
        ? money(combo.price)
        : settings.deliveryEnabled
          ? "এলাকা অনুযায়ী"
          : "ফ্রি";
      featured.querySelector(".pricing-card__unit").textContent = combo
        ? "কম্বো মূল্য"
        : "ডেলিভারি";
      featured.querySelector(".pricing-card__ribbon").textContent = combo
        ? "কম্বো অফার"
        : "বর্তমান নিয়ম";
      featured.querySelector(".pricing-card__checklist").innerHTML = (
        combo
          ? [
              combo.details || "",
              ...combo.items.map(
                (i) =>
                  data.products.find((p) => p.id === i.productId).name +
                  " × " +
                  i.quantity,
              ),
              deliveryText,
            ]
          : [
              deliveryText,
              "ঢাকার ভিতরে: " +
                money(settings.deliveryEnabled ? settings.dhakaFee : 0),
              "ঢাকার বাইরে: " +
                money(settings.deliveryEnabled ? settings.outsideFee : 0),
            ]
      )
        .filter(Boolean)
        .map((line) => '<li class="pricing-card__item">' + e(line) + "</li>")
        .join("");
      featured.querySelector("a").href = combo
        ? "order.html?combo=" + encodeURIComponent(combo.id)
        : "order.html";
    }
  }
  function mobileMenu() {
    const toggle = $(".navbar__toggle"),
      menu = $(".navbar__menu");
    if (!toggle || !menu) return;
    const close = () => {
      menu.classList.remove("is-open");
      toggle.classList.remove("is-active");
      toggle.setAttribute("aria-expanded", "false");
    };
    toggle.onclick = () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      menu.classList.toggle("is-open", open);
      toggle.classList.toggle("is-active", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") close();
    });
    menu.querySelectorAll("a").forEach((a) => (a.onclick = close));
  }
  function error(message) {
    let element = $("#shop-error");
    if (!element) {
      element = document.createElement("p");
      element.id = "shop-error";
      element.className = "shop-notice";
      element.setAttribute("role", "alert");
      element.tabIndex = -1;
      ($("#pvcOrderForm") || $("main")).prepend(element);
    }
    element.textContent = message;
    element.focus();
  }
  async function catalog() {
    const response = await previewFetch("/api/catalog");
    if (!response.ok)
      throw Error(
        "সার্ভারের সঙ্গে সংযোগ হয়নি। npm start চালু করে আবার চেষ্টা করুন।",
      );
    return response.json();
  }
  function cardPreview(product, extras = false) {
    const images = product.images || [];
    const front = Math.max(0, images.findIndex((_, i) => imageSide(product, i) === "front"));
    const back = images.findIndex((_, i) => imageSide(product, i) === "back");
    const hasBack = back >= 0 && back !== front;
    const face = (index, side) => `<div class="card-flip__face card-flip__face--${side}" aria-hidden="${side === "back"}"><img src="${e(imageUrl(images[index]))}" alt="${e(product.name)} — ${sideLabel(side)}" loading="lazy" width="400" height="250"></div>`;
    const placeholder = `<div class="card-flip__face card-flip__face--back card-flip__placeholder" aria-hidden="true"><strong>${e(product.name)}</strong><span>পেছনের দিক</span><small>পেছনের ছবি দেওয়া হয়নি</small></div>`;
    const extraImages = extras ? images.map((src, i) => i !== front && i !== back ? `<figure><img src="${e(imageUrl(src))}" alt="${e(product.name)} — অন্যান্য ছবি" loading="lazy"><figcaption>অন্যান্য ছবি</figcaption></figure>` : "").join("") : "";
    if (!images.length) return '<p>ছবি দেওয়া হয়নি।</p>';
    return `<div class="sample-card__flip-preview"><div class="card-flip"><div class="card-flip__inner">${face(front, "front")}${hasBack ? face(back, "back") : placeholder}</div></div><button type="button" class="btn btn--outline" data-flip-card aria-pressed="false">কার্ড উল্টান — পেছনের দিক দেখুন</button><span class="sample-card__side" role="status">সামনের দিক</span></div>${extraImages}`;
  }
  function bindCardFlips(container) {
    container.querySelectorAll("[data-flip-card]").forEach((button) => {
      button.onclick = () => {
        const preview = button.closest(".sample-card__flip-preview");
        const card = preview.querySelector(".card-flip__inner");
        const flipped = card.classList.toggle("is-flipped");
        button.setAttribute("aria-pressed", String(flipped));
        button.textContent = flipped ? "কার্ড উল্টান — সামনের দিক দেখুন" : "কার্ড উল্টান — পেছনের দিক দেখুন";
        preview.querySelector("[role=status]").textContent = sideLabel(flipped ? "back" : "front");
        card.querySelector(".card-flip__face--front").setAttribute("aria-hidden", String(flipped));
        card.querySelector(".card-flip__face--back").setAttribute("aria-hidden", String(!flipped));
      };
    });
  }
  function productGallery(product) {
    let dialog = $("#product-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "product-dialog";
      document.body.append(dialog);
    }
    dialog.innerHTML = `<button type="button" class="btn btn--outline" id="close-product">বন্ধ করুন</button><h2>${e(product.name)}</h2><p>${e(product.category)} · ${money(unitPrice(product))}</p><p style="white-space:pre-wrap">${e(product.description)}</p><p>${e(product.material)} · ${e(product.size)}</p><div class="product-gallery">${cardPreview(product, true)}</div><a class="btn btn--primary" href="order.html?product=${encodeURIComponent(product.id)}">অর্ডার করুন</a>`;
    $("#close-product").onclick = () => dialog.close();
    bindCardFlips(dialog);
    dialog.showModal();
  }
  async function storefront() {
    const grid = $(".samples-grid");
    if (!grid) return;
    const data = await catalog();
    const offers = document.createElement("section");
    offers.className = "shop-offers";
    offers.innerHTML = data.combos
      .filter(
        (c) =>
          c.enabled &&
          c.items.every((i) => data.products.some((p) => p.id === i.productId)),
      )
      .map(
        (c) =>
          '<article class="shop-notice"><h3>' +
          e(c.name) +
          "</h3><p>" +
          e(c.details || "") +
          "</p><p>" +
          c.items
            .map(
              (i) =>
                e(data.products.find((p) => p.id === i.productId).name) +
                " × " +
                i.quantity,
            )
            .join(" + ") +
          "</p><strong>" +
          money(c.price) +
          '</strong><a class="btn btn--outline" href="order.html?combo=' +
          encodeURIComponent(c.id) +
          '">কম্বো বেছে নিন</a></article>',
      )
      .join("");
    grid.before(offers);
    const filters = document.createElement("div");
    filters.className = "shop-filters";
    filters.innerHTML = `<label>কার্ডের ধরন<select id="public-category" class="form-control"><option value="">সব ক্যাটাগরি</option>${data.categories.map((c) => `<option>${e(c)}</option>`).join("")}</select></label><label>খুঁজুন<input id="product-search" class="form-control" type="search" placeholder="পণ্যের নাম"></label>`;
    grid.before(filters);
    function render() {
      const category = $("#public-category").value,
        query = $("#product-search").value.toLowerCase();
      const products = data.products.filter(
        (p) =>
          (!category || p.category === category) &&
          `${p.name} ${p.description}`.toLowerCase().includes(query),
      );
      grid.innerHTML = products.length
        ? products
            .map(
              (p) =>
                `<article class="sample-card">${cardPreview(p)}<div class="sample-card__body"><div><span>${e(p.category)}</span><h3 class="sample-card__title">${e(p.name)}</h3><p class="sample-card__desc">${e(p.description)}</p><strong>${unitPrice(p) < p.price ? `<del>${money(p.price)}</del> ` : ""}${money(unitPrice(p))} / পিস</strong></div><button class="btn btn--outline" data-details="${e(p.id)}">বিস্তারিত দেখুন</button><a class="btn btn--primary" href="order.html?product=${encodeURIComponent(p.id)}">অর্ডার করুন</a></div></article>`,
            )
            .join("")
        : "<p>কোনো পণ্য পাওয়া যায়নি।</p>";
      bindCardFlips(grid);
      grid
        .querySelectorAll("[data-details]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              productGallery(
                data.products.find((p) => p.id === b.dataset.details),
              )),
        );
    }
    filters.oninput = render;
    render();
  }
  async function checkout() {
    const form = $("#pvcOrderForm");
    if (!form) return;
    const submit = $("#submitOrderBtn");
    submit.disabled = true;
    const data = await catalog();
    const state = new Map(
      data.products.map((p) => [p.id, { ...p, quantity: 0, file: null }]),
    );
    const selected =
      new URLSearchParams(location.search).get("product") ||
      data.products[0]?.id;
    if (state.has(selected)) state.get(selected).quantity = 1;
    const comboId = new URLSearchParams(location.search).get("combo"),
      selectedCombo = data.combos.find((c) => c.id === comboId && c.enabled);
    if (selectedCombo) {
      state.forEach((p) => (p.quantity = 0));
      selectedCombo.items.forEach((i) => {
        if (state.has(i.productId))
          state.get(i.productId).quantity = i.quantity;
      });
    }
    const zoneLabel = document.createElement("label");
    zoneLabel.className = "form-group";
    zoneLabel.innerHTML =
      'ডেলিভারি এলাকা<select id="delivery-zone" class="form-control"><option value="dhaka">ঢাকার ভিতরে</option><option value="outside">ঢাকার বাইরে</option></select>';
    $("#customerAddress").closest(".form-group").after(zoneLabel);
    const discountRow = document.createElement("p");
    discountRow.className = "shop-notice";
    discountRow.id = "summary-discount";
    $("#summarySubtotal").closest("div").after(discountRow);
    const paymentNote = document.createElement("p");
    paymentNote.className = "shop-notice";
    paymentNote.textContent =
      "যোগাযোগ: " +
      (data.settings.phone || "নির্ধারিত হয়নি") +
      " · বিকাশ: " +
      (data.settings.bkash || "নির্ধারিত হয়নি") +
      " · নগদ: " +
      (data.settings.nagad || "নির্ধারিত হয়নি") +
      "। শুধু তথ্যের প্রিভিউ; টাকা পাঠাবেন না।";
    form.append(paymentNote);
    const list = $(".product-option-list");
    list.innerHTML = data.products.length
      ? data.products
          .map(
            (p) =>
              `<section class="product-option-item"><div class="product-option-item__top"><div><small>${e(p.category)}</small><h3 class="product-option-item__name">${e(p.name)}</h3><p>${e(p.description)}</p></div><strong>${money(p.price)}</strong></div><div class="product-option-item__controls"><div class="quantity-stepper"><button type="button" class="quantity-stepper__btn" data-minus="${e(p.id)}" aria-label="${e(p.name)} কমান">−</button><input class="quantity-stepper__input" data-quantity="${e(p.id)}" type="number" min="0" max="1000" value="${state.get(p.id).quantity}" aria-label="${e(p.name)} পরিমাণ"><button type="button" class="quantity-stepper__btn" data-plus="${e(p.id)}" aria-label="${e(p.name)} বাড়ান">+</button></div><label>ডিজাইনের ফাইল (PDF / PNG / JPEG / WebP, সর্বোচ্চ ২ এমবি)<input type="file" data-artwork="${e(p.id)}" accept="application/pdf,image/png,image/jpeg,image/webp"><span data-filename="${e(p.id)}"></span></label><button class="btn btn--outline" type="button" data-remove-file="${e(p.id)}">ফাইল সরান</button></div></section>`,
          )
          .join("")
      : "<p>এখন কোনো পণ্য পাওয়া যাচ্ছে না।</p>";
    const badge = $(".order-card__title-badge");
    if (badge) badge.textContent = "পণ্য অনুযায়ী মূল্য";
    const radio = $('[name="payment_method"]');
    if (radio)
      radio.closest(".form-group").innerHTML =
        '<p class="shop-notice">ক্যাশ অন ডেলিভারির অনুরোধ। এখানে অনলাইন পেমেন্ট নেওয়া হয় না।</p>';
    $("#trxIdGroup")?.remove();
    const notice = document.createElement("p");
    notice.className = "shop-notice";
    notice.textContent =
      "এটি ফ্রন্টএন্ড ডেমো। তথ্য ও ফাইল শুধু এই ব্রাউজারে রাখা হবে। প্রকৃত ব্যক্তিগত তথ্য বা পরিচয়পত্র দেবেন না। কোনো অর্ডার স্টুডিওতে পাঠানো হবে না।";
    form.prepend(notice);
    const message = document.createElement("p");
    message.id = "order-message";
    message.setAttribute("role", "status");
    message.tabIndex = -1;
    submit.before(message);
    let busy = false,
      requestId,
      submitted = false;
    function update() {
      let quantity = 0,
        subtotal = 0;
      const items = [...state.values()].filter((p) => p.quantity > 0);
      for (const item of items) {
        quantity += item.quantity;
        subtotal += item.quantity * item.price;
      }
      const totals = previewTotals(
          [...state.values()]
            .filter((p) => p.quantity > 0)
            .map((p) => ({ productId: p.id, quantity: p.quantity })),
          data,
          $("#delivery-zone").value,
        ),
        delivery = totals.delivery;
      $("#summary-discount").textContent =
        "ছাড়: " +
        money(totals.discount) +
        (totals.offer ? " · " + totals.offer : "");
      $("#summaryItemList").innerHTML =
        items
          .map(
            (p) =>
              `<li class="summary-item"><div><strong>${e(p.name)}</strong><div>${p.quantity} × ${money(p.price)} ${p.file ? "· ফাইল সংযুক্ত" : ""}</div></div><span>${money(p.price * p.quantity)}</span></li>`,
          )
          .join("") || "<li>অন্তত একটি কার্ড বেছে নিন।</li>";
      $("#summarySubtotal").textContent = money(subtotal);
      $("#summaryTotal").textContent = money(totals.amount);
      $("#summaryDelivery").textContent = money(delivery);
      $("#summaryTotalCount").textContent =
        `${new Intl.NumberFormat("bn-BD").format(quantity)} পিস`;
      const promo = $("#summaryPromoAlert");
      if (promo)
        promo.textContent =
          delivery === 0
            ? "ডেলিভারি চার্জ প্রযোজ্য নয়।"
            : "ডেলিভারি: " + money(delivery);
      submit.disabled = busy || submitted || !quantity;
    }
    list.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const id = b.dataset.plus || b.dataset.minus || b.dataset.removeFile;
      if (!id) return;
      const p = state.get(id);
      if (b.dataset.removeFile) {
        p.file = null;
        list.querySelector(`[data-artwork="${id}"]`).value = "";
        list.querySelector(`[data-filename="${id}"]`).textContent = "";
      } else {
        p.quantity = Math.min(
          1000,
          Math.max(0, p.quantity + (b.dataset.plus ? 1 : -1)),
        );
        list.querySelector(`[data-quantity="${id}"]`).value = p.quantity;
      }
      update();
    };
    list.onchange = async (ev) => {
      if (ev.target.dataset.quantity) {
        const p = state.get(ev.target.dataset.quantity);
        p.quantity = Math.min(
          1000,
          Math.max(0, Math.trunc(Number(ev.target.value) || 0)),
        );
        ev.target.value = p.quantity;
        update();
      }
      if (ev.target.dataset.artwork) {
        const id = ev.target.dataset.artwork,
          p = state.get(id),
          file = ev.target.files[0];
        p.file = null;
        list.querySelector(`[data-filename="${id}"]`).textContent = "";
        if (!file) {
          update();
          return;
        }
        busy = true;
        update();
        try {
          if (
            ![
              "application/pdf",
              "image/png",
              "image/jpeg",
              "image/webp",
            ].includes(file.type) ||
            file.size > 2 * 1024 * 1024
          )
            throw Error(
              "সর্বোচ্চ ২ এমবি আকারের PDF, PNG, JPEG বা WebP ফাইল দিন।",
            );
          const data = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(Error("ফাইল পড়া যায়নি।"));
            r.readAsDataURL(file);
          });
          p.file = { name: file.name, data };
          if (!p.quantity) {
            p.quantity = 1;
            list.querySelector(`[data-quantity="${id}"]`).value = 1;
          }
          list.querySelector(`[data-filename="${id}"]`).textContent = file.name;
        } catch (err) {
          ev.target.value = "";
          error(err.message);
        } finally {
          busy = false;
          update();
        }
      }
    };
    $("#delivery-zone").onchange = update;
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (busy || submitted) return;
      const customer = $("#customerName").value.trim(),
        phone = digits($("#customerPhone").value).replace(/[\s-]/g, ""),
        location = $("#customerAddress").value.trim(),
        items = [...state.values()]
          .filter((p) => p.quantity > 0)
          .map((p) => ({
            productId: p.id,
            quantity: p.quantity,
            file: p.file,
          }));
      if (
        !customer ||
        !/^(?:\+?88)?01[3-9]\d{8}$/.test(phone) ||
        location.length < 8 ||
        !items.length
      ) {
        error(
          "নাম, সঠিক মোবাইল নম্বর, সম্পূর্ণ ঠিকানা এবং কার্ডের পরিমাণ দিন।",
        );
        return;
      }
      busy = true;
      update();
      message.textContent = "অনুরোধ পাঠানো হচ্ছে…";
      try {
        requestId ||= crypto.randomUUID();
        const response = await previewFetch("/api/order-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            zone: $("#delivery-zone").value,
            customer,
            phone,
            location,
            requirements: $("#customerNotes")?.value || "",
            items,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw Error(
            response.status === 400
              ? "তথ্য ও ফাইল যাচাই করুন। অনুমোদিত ফাইলের আকার সর্বোচ্চ ২ এমবি।"
              : "অনুরোধ পাঠানো যায়নি। পরে আবার চেষ্টা করুন।",
          );
        submitted = true;
        message.textContent = `ডেমো এই ব্রাউজারে সংরক্ষিত হয়েছে। নম্বর: ${result.id}। মোট: ${money(result.amount)}। পেমেন্ট নেওয়া হয়নি।`;
        message.focus();
        submit.textContent = "ডেমো সংরক্ষিত হয়েছে";
        form
          .querySelectorAll("input,textarea,button")
          .forEach((el) => (el.disabled = true));
      } catch (err) {
        error(err.message);
        message.textContent = "";
      } finally {
        busy = false;
        update();
      }
    };
    update();
  }
  applyBusiness();
  applyPublicPricing();
  mobileMenu();
  Promise.all([storefront(), checkout()]).catch((err) => error(err.message));
}
