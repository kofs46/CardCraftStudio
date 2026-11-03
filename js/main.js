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
const imageUrl = (src) => src === "images/product-keyring-photo.jpg" ? "images/product-keyring-photo.png" : String(src || "");

// Catalog defaults are display-only. The server validates and prices every order.
const defaultSettings = {
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
  freeThreshold: 5,
};
const isBikeKeyring = (p) => p?.customization === "bike-keyring" || p?.id === "bike-keyring";
const printPrice = (p, sides = 1) => isBikeKeyring(p) && Number(sides) === 2 ? p.doublePrice : p.price;
function keyringDetails(item) {
  const printSides = Number(item.printSides ?? 1);
  if (![1, 2].includes(printSides)) throw Error("এক পাশে অথবা দুই পাশে প্রিন্ট বেছে নিন।");
  const raw = item.personalization || {};
  const personalization = {
    bikeBrand: String(raw.bikeBrand || "").trim(),
    bikeNumber: String(raw.bikeNumber || "").trim(),
    ownerName: String(raw.ownerName || "").trim(),
    phone: digits(String(raw.phone || "")).replace(/[\s-]/g, ""),
  };
  if (!personalization.bikeBrand || personalization.bikeBrand.length > 80) throw Error("বাইকের ব্র্যান্ডের নাম দিন (সর্বোচ্চ ৮০ অক্ষর)।");
  if (!/^[A-Za-z0-9][A-Za-z0-9 /-]{1,49}$/.test(personalization.bikeNumber)) throw Error("বাইকের নম্বর ইংরেজি অক্ষর ও সংখ্যায় লিখুন।");
  if (!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(personalization.ownerName)) throw Error("নিজের নাম ইংরেজিতে লিখুন (সর্বোচ্চ ৮০ অক্ষর)।");
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(personalization.phone)) throw Error("কি রিংয়ে প্রিন্টের জন্য সঠিক ফোন নম্বর দিন।");
  let backPhoto = null;
  if (printSides === 2 && item.backPhoto) {
    const photo = item.backPhoto;
    if (typeof photo.name !== "string" || !photo.name || photo.name.length > 255 ||
        typeof photo.data !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.data) || photo.data.length > 2 * 1024 * 1024 * 4 / 3 + 100)
      throw Error("পেছনের ছবির জন্য সর্বোচ্চ ২ এমবি PNG, JPEG বা WebP দিন।");
    backPhoto = { name: photo.name, data: photo.data };
  }
  return { printSides, personalization, backPhoto };
}
const isNfc = p => p?.id === "premium-nfc" || p?.sourceProductId === "premium-nfc" || p?.customization === "nfc";
const nfcLabels = {displayName:"প্রদর্শনের নাম",title:"পদবি / পেশা",company:"প্রতিষ্ঠান",phone:"প্রদর্শনের ফোন নম্বর",email:"ইমেইল",facebook:"Facebook লিংক",instagram:"Instagram লিংক",youtube:"YouTube লিংক",linkedin:"LinkedIn লিংক",website:"ওয়েবসাইট",bio:"পরিচিতি",other:"অন্য তথ্য ও নির্দেশনা"};
const statusNames = {Pending:"অপেক্ষমাণ",Processing:"প্রস্তুত হচ্ছে",Printing:"প্রিন্টিং হচ্ছে",Completed:"সম্পন্ন",Cancelled:"বাতিল"};
const statusBadge = status => `<span class="order-status order-status--${e(String(status).toLowerCase())}">${status === "Cancelled" ? "✕ " : ""}${e(statusNames[status] || status)}</span>`;

const cartStorageKey = "cardcraft_cart_v1";
const cartLineKey = (id, sides = 1) => id + "::" + Number(sides);
function readCart(products) {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(cartStorageKey) || "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const lines = new Map();
  for (const item of raw) {
    if (!item || typeof item.productId !== "string" || !item.productId || item.productId.length > 128) continue;
    const p = products?.find(p => p.id === item.productId && p.available);
    if (products && !p) continue;
    const quantity = Math.min(1000, Math.max(0, Math.trunc(Number(item.quantity) || 0)));
    if (!quantity) continue;
    const printSides = (p ? isBikeKeyring(p) : item.productId === "bike-keyring") && Number(item.printSides) === 2 ? 2 : 1;
    const key = cartLineKey(item.productId, printSides);
    lines.set(key, { productId: item.productId, quantity: Math.min(1000, quantity + (lines.get(key)?.quantity || 0)), printSides });
  }
  return [...lines.values()];
}
function saveCart(lines) {
  try { localStorage.setItem(cartStorageKey, JSON.stringify(lines)); }
  catch { throw Error("অর্ডার তালিকা সংরক্ষণ করা যায়নি। ব্রাউজারের স্টোরেজ পরীক্ষা করুন।"); }
}
function addCartItem(product, sides = 1, quantity = 1) {
  if (!product?.id || !product.available) throw Error("এই পণ্য এখন পাওয়া যাচ্ছে না।");
  const printSides = isBikeKeyring(product) && Number(sides) === 2 ? 2 : 1;
  const count = Math.min(1000, Math.max(1, Math.trunc(Number(quantity) || 1)));
  const lines = readCart();
  const line = lines.find(i => cartLineKey(i.productId, i.printSides) === cartLineKey(product.id, printSides));
  if (line) line.quantity = Math.min(1000, line.quantity + count);
  else lines.push({ productId: product.id, quantity: count, printSides });
  saveCart(lines);
  return lines;
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
function calculateTotals(items, data, zone = "dhaka") {
  const rows = items.map((i) => {
    const p = data.products.find(p => p.id === i.productId) || i;
    return { ...i, product: { ...p, price: printPrice(p, i.printSides) } };
  });
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

async function readApiJson(response) {
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const hint = local
      ? "প্রজেক্টে npm.cmd start চালিয়ে http://localhost:5175 খুলুন। VS Code Live Server দিয়ে backend চলে না।"
      : "হোস্টিংয়ে /api রুট এবং deployment access protection যাচাই করুন।";
    throw Error(`সার্ভার থেকে সঠিক API উত্তর পাওয়া যায়নি (HTTP ${response.status})। ${hint}`);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw Error("API-এর উত্তর সঠিক নয়। backend ও /api রুটের সেটআপ যাচাই করুন।");
  }
  return result;
}

let liveCatalog = null;
const uploadedFiles = new Map();
function catalogSnapshot() {
  return liveCatalog || {products:[],categories:[],settings:defaultSettings,combos:[],orders:[]};
}
async function apiFetch(url, options = {}) {
  if (location.protocol === "file:") {
    throw Error("আপনি HTML ফাইল সরাসরি খুলেছেন। প্রজেক্টের Terminal-এ npm.cmd start চালিয়ে http://localhost:5175 খুলুন। backend চালাতে Supabase-এর .env সেটআপও প্রয়োজন।");
  }
  const request = {...options, credentials:"same-origin", cache:"no-store"};
  if (request.body) {
    const body=JSON.parse(request.body);
    const uploadFile=async(file) => {
      if(!file?.data?.startsWith("data:"))return file;
      if(uploadedFiles.has(file.data))return {...uploadedFiles.get(file.data),name:file.name};
      const response=await fetch('/api/upload',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'artwork',data:file.data})});
      const result=await readApiJson(response);if(!response.ok)throw Error(result.error||'ফাইল আপলোড হয়নি।');
      const reference={name:file.name,receipt:result.receipt};uploadedFiles.set(file.data,reference);return reference;
    };
    if(url==='/api/order-request')for(const item of body.items){item.file=await uploadFile(item.file);item.backPhoto=await uploadFile(item.backPhoto);}
    if(url==='/api/products'&&Array.isArray(body.images))for(let i=0;i<body.images.length;i++)if(body.images[i].startsWith('data:')){
      const response=await fetch('/api/upload',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'product',data:body.images[i]})});
      const result=await readApiJson(response);if(!response.ok)throw Error(result.error||'ছবি আপলোড হয়নি।');body.images[i]=result.url;
    }
    request.body=JSON.stringify(body);
  }
  return fetch(url,request);
}
async function loadLiveCatalog() {
  const response=await apiFetch('/api/catalog');
  const result=await readApiJson(response);
  if(!response.ok)throw Error(result.error||'সার্ভারের সঙ্গে সংযোগ হয়নি।');
  liveCatalog=result;return result;
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
    "অর্ডার করা গ্রাহকদের তথ্য শুধু অনুমোদিত অ্যাডমিন দেখতে পারবেন।":
      "অর্ডার করা গ্রাহকদের তথ্য শুধু অনুমোদিত অ্যাডমিন দেখতে পারবেন।",
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
  let page = new URLSearchParams(location.search).get("view") || "login";
  let lastAdminLoad = 0;
  let adminReload = null;
  const loginPage = ["index", "login"].includes(page);
  const statuses = [
    "Pending",
    "Processing",
    "Printing",
    "Completed",
    "Cancelled",
  ];
  async function api(route, method = "GET", body) {
    const response = await apiFetch(`/api/${route}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await readApiJson(response);
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
    if (adminReload) return adminReload;
    adminReload = (async () => {
      const latest = await api("admin");
      data = latest;
      lastAdminLoad = Date.now();
      render();
      localizeAdmin();
    })();
    try { await adminReload; } finally { adminReload = null; }
  }
  function navigateAdmin(url, push = true) {
    const next = url.searchParams.get("view") || "login";
    const views = ["dashboard", "analytics", "categories", "products", "combos", "delivery", "business", "orders", "customers", "images"];
    if (!data || !views.includes(next)) return false;
    if (push) history.pushState(null, "", url.pathname + url.search);
    page = next;
    render();
    localizeAdmin();
    if (Date.now() - lastAdminLoad > 30000) {
      reload().catch(error => message(error.message));
    }
    return true;
  }
  app.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith("/admin.html")) return;
    if (navigateAdmin(url)) event.preventDefault();
  });
  window.addEventListener("popstate", () => {
    if (!navigateAdmin(new URL(location.href), false)) location.reload();
  });
  function table(headers, rows) {
    return `<div class="table-scroll table-container"><table class="admin-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">No records yet.</td></tr>`}</tbody></table></div>`;
  }
  function dashboard() {
    const productValue = (o) => Math.max(0, (Number(o.amount) || 0) - (Number(o.delivery) || 0));
    const completed = data.orders.filter(o => o.status === "Completed");
    const active = data.orders.filter(o => ["Pending", "Processing", "Printing"].includes(o.status));
    const sum = (orders) => orders.reduce((total, o) => total + productValue(o), 0);
    const day = (date) => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Dhaka", year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(date));
    const today = day(new Date());
    const todayCompleted = completed.filter(o => o.date && !Number.isNaN(Date.parse(o.date)) && day(o.date) === today);
    const cards = [
      ["সম্পন্ন বিক্রির মূল্য", money(sum(completed)), "green", "৳"],
      ["আজকের সম্পন্ন বিক্রি", money(sum(todayCompleted)), "teal", "৳"],
      ["চলমান অর্ডারের মূল্য", money(sum(active)), "amber", "৳"],
      ["মোট অর্ডার", data.orders.length, "blue", "▤"],
    ];
    const statusNames = {Pending:"অপেক্ষমাণ",Processing:"প্রস্তুত হচ্ছে",Printing:"প্রিন্টিং চলছে",Completed:"সম্পন্ন",Cancelled:"বাতিল"};
    return `<div class="dashboard-summary"><h2>বিক্রির হিসাব</h2><p>পণ্যের মূল্য থেকে হিসাব করা হয়েছে; ডেলিভারি চার্জ বাদ। এটি অর্ডারের হিসাব, নগদ বা ব্যাংকের ব্যালেন্স নয়।</p></div><div class="admin-stats-grid">${cards.map(([label,value,color,icon]) => `<div class="stat-card"><div class="stat-card__icon stat-card__icon--${color}">${icon}</div><div><div class="stat-card__num">${e(value)}</div><div class="stat-card__label">${label}</div></div></div>`).join("")}</div><section class="dashboard-statuses" aria-label="অর্ডারের অবস্থার সারসংক্ষেপ">${statuses.map(status => { const orders=data.orders.filter(o=>o.status===status); return `<a href="admin.html?view=dashboard&status=${status}" class="dashboard-status-card order-state--${status.toLowerCase()}" data-count="${orders.length}"><span>${statusBadge(status)}</span><strong>${orders.length}টি অর্ডার</strong><small>পণ্যের মূল্য ${money(sum(orders))}</small></a>`; }).join("")}</section><h2>অর্ডারের বিবরণ</h2><div class="admin-toolbar"><label class="admin-search-box">অর্ডার খুঁজুন<input id="overview-search" class="form-control" placeholder="নাম, ফোন বা অর্ডার নম্বর"></label><label>অবস্থা<select id="overview-status" class="form-control"><option value="">সব অর্ডার</option>${options(statuses)}</select></label></div><div id="overview-orders">${orderTable(data.orders.slice().reverse())}</div>`;
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
          `<tr><td>${e(o.id)}</td><td>${e(o.customer)}<br>${e(o.phone)}</td><td>${e(o.product)}</td><td>${e(o.quantity)}</td><td>${money(o.amount)}</td><td>${statusBadge(o.status)}<select aria-label="Order status ${e(o.id)}" data-status="${e(o.id)}">${options(statuses, o.status)}</select></td><td><button data-order="${e(o.id)}">View details</button></td></tr>`,
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
      dashboard: "ড্যাশবোর্ড",
      categories: "ক্যাটাগরি",
      products: "পণ্য ও ছাড়",
      combos: "কম্বো অফার",
      delivery: "ডেলিভারি চার্জ",
      business: "ব্যবসার তথ্য",
      orders: "সকল অর্ডার",
      customers: "গ্রাহকের তথ্য",
      images: "কার্ডের ছবি",
    };
    app.innerHTML = `<header class="admin-navbar"><div class="container admin-navbar__inner"><a class="original-admin-brand" href="admin.html?view=dashboard">${e(data.settings.businessName || defaultSettings.businessName)} <span>| অ্যাডমিন প্যানেল</span></a><div class="original-header-actions"><button id="refresh-admin" type="button">তথ্য রিফ্রেশ করুন</button><a href="index.html">ওয়েবসাইট দেখুন</a><button id="logout" type="button">লগআউট</button></div></div></header><main id="main" class="container live-admin original-admin admin-layout"><aside class="admin-sidebar"><h2>পরিচালনা</h2><nav class="admin-sidebar-nav" aria-label="অ্যাডমিন অপশন">${Object.entries(
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
      )}</nav></aside><div class="admin-main"><div class="original-admin-heading"><h1>${labels[page] || "অ্যাডমিন প্যানেল"}</h1><p>অর্ডার, পণ্য ও বিক্রির হিসাব</p></div><p id="live-message" role="status" tabindex="-1"></p><section id="workspace"></section></div></main>`;
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
      workspace.innerHTML = `<label>Search customers<input id="customer-search" placeholder="Name, email or phone"></label><div id="customer-list"></div><p>অর্ডার করা গ্রাহকদের তথ্য শুধু অনুমোদিত অ্যাডমিন দেখতে পারবেন।</p>`;
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
            `<tr><td><img width="80" height="55" style="object-fit:contain" alt="${e(p.name)}" src="${e(p.images[0].startsWith("data:") ? p.images[0] : p.images[0])}"></td><td>${e(p.name)}<br><small>${p.images.map((_, i) => sideLabel(imageSide(p, i))).join(" · ")}</small></td><td>${e(p.category)}</td><td>${money(p.price)}${isBikeKeyring(p) ? `<br><small>এক পাশে · দুই পাশে ${money(p.doublePrice)}</small>` : ""}${unitPrice(p) < p.price ? `<br><strong>After discount: ${money(unitPrice(p))}</strong>` : ""}</td><td>${p.available ? "Visible" : "Hidden"}</td><td><button data-edit="${e(p.id)}">Edit</button> <button data-delete="${e(p.id)}">Delete</button></td></tr>`,
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
      `<form id="product-form" class="admin-panel"><h2>${p.id ? "Edit" : "Add"} product</h2>${field("Product name", "name", p.name, "text", 'required maxlength="200"')}<label>Category<select name="category" required>${options(data.categories, p.category)}</select></label>${field(isBikeKeyring(p) ? "এক পাশে প্রিন্টের মূল্য (টাকা)" : "Unit price (BDT)", "price", p.price ?? 0, "number", 'required min="0" max="10000000" step="0.01"')}${isBikeKeyring(p) ? field("দুই পাশে প্রিন্টের মূল্য (টাকা)", "doublePrice", p.doublePrice ?? 300, "number", 'required min="0" max="10000000" step="0.01"') : ""}<label>Discount type<select name="discountType">${options(["fixed", "percent"], p.discountType || "fixed")}</select></label>${field("Discount amount (BDT or %)", "discount", p.discount || 0, "number", 'min="0" step="0.01" required')}<label>Details<textarea name="description" maxlength="5000">${e(p.description)}</textarea></label>${field("Material", "material", p.material || "PVC")}${field("Size", "size", p.size)}<label><input name="available" type="checkbox" ${p.available ? "checked" : ""}> Visible in storefront</label><label><input name="featured" type="checkbox" ${p.featured ? "checked" : ""}> Featured product</label><h3>পণ্যের সামনের ও পেছনের ছবি</h3><div class="card-side-uploads"><label>সামনের দিকের ছবি<input id="product-front-image" type="file" accept="image/png,image/jpeg,image/webp"></label><label>পেছনের দিকের ছবি<input id="product-back-image" type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>Multiple images (up to 6; PNG, JPEG, WebP; 2 MB each)<input id="product-images" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><p>The first image is the cover. Remove old images before replacing them.</p><div id="image-previews" class="live-images"></div><p id="image-error" role="alert"></p><button class="btn btn-primary" id="save-product">Save product</button><button class="btn btn-secondary" id="cancel-product" type="button">Cancel</button></form>`;
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
          ...(isBikeKeyring(p) ? { customization: "bike-keyring", doublePrice: Number(f.get("doublePrice")) } : {}),
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
    document.querySelector("#refresh-admin").onclick = () => run(async () => {
      const button = document.querySelector("#refresh-admin");
      button.disabled = true;
      button.textContent = "লোড হচ্ছে…";
      try { await reload(); } finally {
        if (button.isConnected) { button.disabled = false; button.textContent = "তথ্য রিফ্রেশ করুন"; }
      }
    });
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
    const initialStatus = new URLSearchParams(location.search).get("status");
    if (document.querySelector("#overview-status") && statuses.includes(initialStatus)) {
      document.querySelector("#overview-status").value = initialStatus;
      filterOverview();
    }
    document.querySelector("#workspace").onclick = async (ev) => {
      const id = ev.target.closest("[data-order]")?.dataset.order;
      if (!id) return;
      let order;
      try { order = await api("order-details?id=" + encodeURIComponent(id)); }
      catch (error) { message(error.message); return; }
      const dialog = document.querySelector("#modal");
      document.querySelector("#modal-content").innerHTML =
        `<h2>${e(order.id)}</h2><p>${e(order.customer)} · ${e(order.phone)} · ${e(order.email)}</p><p>${e(order.location)}</p><p>${e(order.date)}</p><h3>Design requirements</h3><p style="white-space:pre-wrap">${e(order.requirements)}</p>${table(
          ["Product", "Quantity", "Unit price", "Artwork"],
          order.items.map(
            (item) =>
              `<tr><td>${e(item.name)}${item.nfc ? `<h4>NFC স্ক্যানের পর দেখানোর তথ্য</h4><dl>${Object.entries(item.nfc).filter(([,value])=>value).map(([key,value])=>`<dt>${e(nfcLabels[key] || key)}</dt><dd style="white-space:pre-wrap;overflow-wrap:anywhere">${e(value)}</dd>`).join("")}</dl>` : ""}${item.personalization ? `<p>${item.printSides === 2 ? "দুই পাশে প্রিন্ট" : "এক পাশে প্রিন্ট"}</p><dl><dt>Bike brand</dt><dd>${e(item.personalization.bikeBrand)}</dd><dt>Bike number</dt><dd>${e(item.personalization.bikeNumber)}</dd><dt>Owner name</dt><dd>${e(item.personalization.ownerName)}</dd><dt>Phone</dt><dd>${e(item.personalization.phone)}</dd></dl>` : ""}</td><td>${item.quantity}</td><td>${money(item.price)}</td><td>${item.file ? `<a download="${e(item.file.name)}" href="${e(item.file.data)}">Download ${e(item.file.name)}</a>` : "No file"}${item.backPhoto ? `<p>পেছনের নিজের ছবি: <a download="${e(item.backPhoto.name)}" href="${e(item.backPhoto.data)}">${e(item.backPhoto.name)}</a></p><img src="${e(item.backPhoto.data)}" alt="অর্ডারের পেছনের ছবি" width="100" height="100" style="object-fit:contain">` : ""}</td></tr>`,
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
    app.innerHTML = `<div id="adminLoginGate"><main id="main" class="login-card"><img src="images/cardcraft-studio-bd-logo.jpeg" alt="CardCraft Studio BD লোগো" class="login-brand-logo" width="112" height="112"><h1>অ্যাডমিন প্যানেল</h1><p>${e(catalogSnapshot().settings.businessName)}</p><p id="live-message" role="alert" tabindex="-1"></p><form id="sign-in"><label>ইমেইল<input class="form-control" name="email" type="email" autocomplete="username" required maxlength="254"></label><label>পাসওয়ার্ড<input class="form-control" name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button class="btn btn--primary btn--block">লগইন করুন</button></form><small>শুধু অনুমোদিত অ্যাডমিন প্রবেশ করতে পারবেন।</small><p><a href="index.html">ওয়েবসাইটে ফিরে যান</a></p></main></div>`;
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
  setInterval(() => {
    if (!data || !["dashboard", "orders"].includes(page) || document.visibilityState !== "visible") return;
    if (document.activeElement?.closest("#workspace input, #workspace select, #workspace textarea")) return;
    reload().catch(error => message(error.message));
  }, 30000);
  start().catch((error) => {
    app.innerHTML =
      '<main class="live-login"><h1>অ্যাডমিন সংযোগ পাওয়া যায়নি</h1><p id="live-message" role="alert" tabindex="-1"></p><p>সার্ভারের সেটআপ যাচাই করে আবার চেষ্টা করুন।</p></main>';
    message(error.message);
  });
} else {
  const $ = (selector) => document.querySelector(selector);
  function applyBusiness() {
    const settings = catalogSnapshot().settings;
    const phoneHref = (value) => "tel:" + digits(value).replace(/[^+0-9]/g, "");
    if (settings.businessName)
      document
        .querySelectorAll(".footer__brand-title, [data-business-name]")
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
    if (event.key === cartStorageKey) applyBusiness();
  });
  function applyPublicPricing() {
    const data = catalogSnapshot(),
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
        : "order-list.html";
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
    if (liveCatalog) return liveCatalog;
    const response = await apiFetch("/api/catalog");
    if (!response.ok)
      throw Error(
        "সার্ভারের সঙ্গে সংযোগ হয়নি। npm start চালু করে আবার চেষ্টা করুন।",
      );
    return liveCatalog || readApiJson(response);
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
    return `<div class="sample-card__flip-preview"><div class="card-flip"><div class="card-flip__inner">${face(front, "front")}${hasBack ? face(back, "back") : placeholder}</div></div><button type="button" class="btn btn--outline" data-flip-card aria-pressed="false">উল্টে পেছনের দিক দেখুন</button><span class="sample-card__side" role="status">সামনের দিক</span></div>${extraImages}`;
  }
  function bindCardFlips(container) {
    container.querySelectorAll("[data-flip-card]").forEach((button) => {
      button.onclick = () => {
        const preview = button.closest(".sample-card__flip-preview");
        const card = preview.querySelector(".card-flip__inner");
        const flipped = card.classList.toggle("is-flipped");
        button.setAttribute("aria-pressed", String(flipped));
        button.textContent = flipped ? "উল্টে সামনের দিক দেখুন" : "উল্টে পেছনের দিক দেখুন";
        preview.querySelector("[role=status]").textContent = sideLabel(flipped ? "back" : "front");
        card.querySelector(".card-flip__face--front").setAttribute("aria-hidden", String(flipped));
        card.querySelector(".card-flip__face--back").setAttribute("aria-hidden", String(!flipped));
      };
    });
  }
  function updateCartBadge() {
    const count = readCart().reduce((sum, line) => sum + line.quantity, 0);
    document.querySelectorAll("[data-cart-count]").forEach(el => el.textContent = new Intl.NumberFormat("bn-BD").format(count));
  }
  function initCartLinks() {
    const host = document.querySelector(".navbar__inner > div:last-child") || document.querySelector(".order-header-nav__inner");
    document.querySelectorAll(".cart-link").forEach(link => link.remove());
    if (host) {
      let link = document.querySelector(".navbar__cta") || host.querySelector(".order-list-link");
      if (!link) {
        link = document.createElement("a");
        link.className = "btn btn--primary order-list-link";
        host.querySelector(".navbar__brand")?.after(link);
        if (!link.isConnected) host.prepend(link);
      }
      link.classList.add("order-list-link");
      link.href = "order-list.html";
      link.innerHTML = 'অর্ডার করুন (<span data-cart-count>০</span>)';
    }
    updateCartBadge();
    window.addEventListener("storage", event => {
      if (event.key === cartStorageKey) { updateCartBadge(); if (document.querySelector("#cart-page")) cartPage().catch(err => error(err.message)); }
    });
  }
  function cartNotice(container, text = "অর্ডার তালিকায় যোগ হয়েছে।") {
    let notice = container.querySelector("[data-cart-notice]");
    if (!notice) {
      notice = document.createElement("p"); notice.dataset.cartNotice = "true";
      notice.className = "shop-notice"; notice.setAttribute("role", "status"); container.append(notice);
    }
    notice.replaceChildren(document.createTextNode(text + " "));
    const link = document.createElement("a"); link.href = "order-list.html"; link.textContent = "অর্ডার তালিকা দেখুন"; notice.append(link);
  }
  async function cartPage() {
    const page = document.querySelector("#cart-page");
    if (!page) return;
    const data = await catalog();
    function render() {
      const lines = readCart(data.products);
      saveCart(lines); updateCartBadge();
      const totals = calculateTotals(lines, data);
      page.querySelector("#cart-items").innerHTML = lines.length ? lines.map(line => {
        const product = data.products.find(p => p.id === line.productId);
        const key = cartLineKey(line.productId, line.printSides);
        const price = unitPrice({ ...product, price: printPrice(product, line.printSides) });
        return `<article class="cart-item"><img src="${e(imageUrl(product.images[0]))}" alt="${e(product.name)}" width="96" height="96"><div><h2>${e(product.name)}</h2>${isBikeKeyring(product) ? `<p>${line.printSides === 2 ? "দুই পাশে প্রিন্ট" : "এক পাশে প্রিন্ট"}</p>` : ""}<p>প্রতি পিস ${money(price)}</p><div class="cart-item-controls"><button class="btn btn--outline" type="button" data-cart-minus="${e(key)}" aria-label="${e(product.name)} কমান">−</button><label>পরিমাণ<input type="number" min="1" max="1000" value="${line.quantity}" data-cart-quantity="${e(key)}" inputmode="numeric"></label><button class="btn btn--outline" type="button" data-cart-plus="${e(key)}" aria-label="${e(product.name)} বাড়ান">+</button><strong>${money(price * line.quantity)}</strong><button type="button" class="btn btn--outline" data-cart-remove="${e(key)}">সরান</button></div></div></article>`;
      }).join("") : '<p class="shop-notice">আপনার অর্ডার তালিকা খালি। পণ্যের অর্ডার করুন বাটন দিয়ে পণ্য যোগ করুন।</p>';
      page.querySelector("#cart-subtotal").textContent = money(totals.subtotal);
      page.querySelector("#cart-discount").textContent = money(totals.discount);
      page.querySelector("#cart-net").textContent = money(totals.net);
      page.querySelector("#cart-checkout").hidden = !lines.length;
      page.querySelector("#cart-checkout").setAttribute("aria-disabled", String(!lines.length));
    }
    function modify(key, change) {
      const lines = readCart(data.products);
      const line = lines.find(i => cartLineKey(i.productId, i.printSides) === key);
      if (!line) return;
      change(line);
      saveCart(lines.filter(i => i.quantity > 0)); render();
    }
    page.onclick = ev => {
      const b = ev.target.closest("button"); if (!b) return;
      try {
        if (b.dataset.cartRemove) modify(b.dataset.cartRemove, line => line.quantity = 0);
        if (b.dataset.cartPlus) modify(b.dataset.cartPlus, line => line.quantity = Math.min(1000, line.quantity + 1));
        if (b.dataset.cartMinus) modify(b.dataset.cartMinus, line => line.quantity--);
      } catch (err) { error(err.message); }
    };
    page.onchange = ev => {
      if (!ev.target.dataset.cartQuantity) return;
      try { modify(ev.target.dataset.cartQuantity, line => line.quantity = Math.min(1000, Math.max(0, Math.trunc(Number(ev.target.value) || 0)))); }
      catch (err) { error(err.message); }
    };
    render();
  }

  function productGallery(product) {
    let dialog = $("#product-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "product-dialog";
      document.body.append(dialog);
    }
    dialog.innerHTML = `<button type="button" class="btn btn--outline" id="close-product">বন্ধ করুন</button><h2>${e(product.name)}</h2><p>${e(product.category)} · ${money(unitPrice(product))}${isBikeKeyring(product) ? " থেকে" : ""}</p><p style="white-space:pre-wrap">${e(product.description)}</p><p>${e(product.material)} · ${e(product.size)}</p><div class="product-gallery">${cardPreview(product, true)}</div><a class="btn btn--primary" href="order.html?product=${encodeURIComponent(product.id)}">অর্ডার করুন</a>`;
    if (isBikeKeyring(product)) {
      const orderLink = dialog.querySelector('a[href^="order.html"]');
      const controls = document.createElement("fieldset");
      controls.className = "keyring-print-options";
      controls.innerHTML = `<legend>প্রিন্টের ধরন বেছে নিন</legend><label><input type="radio" name="keyring-sides" value="1" checked> এক পাশে প্রিন্ট — ${money(product.price)}</label><label><input type="radio" name="keyring-sides" value="2"> দুই পাশে প্রিন্ট — ${money(product.doublePrice)}</label><p>দুই পাশে প্রিন্টে পেছনে নিজের ছবি দেওয়ার সুযোগ আছে। অর্ডারের সময় বাইকের তথ্য দিন।</p><strong id="keyring-option-price" role="status">${money(unitPrice(product))}</strong>`;
      orderLink.before(controls);
      const choose = () => {
        const sides = Number(controls.querySelector('input:checked').value);
        dialog.dataset.printSides = String(sides);
        controls.querySelector('#keyring-option-price').textContent = money(unitPrice({ ...product, price: printPrice(product, sides) }));
      };
      controls.onchange = choose;
      choose();
    }
    const add = document.createElement("button");
    add.type = "button"; add.className = "btn btn--primary"; add.textContent = "অর্ডারে যোগ করুন";
    add.id = "details-add-cart";
    add.onclick = () => {
      try {
        const sides = Number(dialog.querySelector('input[name="keyring-sides"]:checked')?.value || 1);
        addCartItem(product, sides); updateCartBadge(); cartNotice(dialog);
      } catch (err) { cartNotice(dialog, err.message); }
    };
    dialog.querySelector('a[href^="order.html"]').replaceWith(add);
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
    filters.innerHTML = `<label>পণ্যের ধরন<select id="public-category" class="form-control"><option value="">সব ক্যাটাগরি</option>${data.categories.map((c) => `<option>${e(c)}</option>`).join("")}</select></label><label>খুঁজুন<input id="product-search" class="form-control" type="search" placeholder="পণ্যের নাম"></label>`;
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
                `<article class="sample-card">${cardPreview(p)}<div class="sample-card__body"><div><span>${e(p.category)}</span><h3 class="sample-card__title">${e(p.name)}</h3><p class="sample-card__desc">${e(p.description)}</p><strong>${unitPrice(p) < p.price ? `<del>${money(p.price)}</del> ` : ""}${money(unitPrice(p))}${isBikeKeyring(p) ? " থেকে" : ""} / পিস</strong></div><button class="btn btn--outline" data-details="${e(p.id)}">বিস্তারিত দেখুন</button>${isBikeKeyring(p) ? `<button class="btn btn--primary" data-details="${e(p.id)}">অর্ডার করুন</button>` : `<button class="btn btn--primary" data-add-cart="${e(p.id)}">অর্ডার করুন</button>`}</div></article>`,
            )
            .join("")
        : "<p>কোনো পণ্য পাওয়া যায়নি।</p>";
      bindCardFlips(grid);
      grid.querySelectorAll("[data-add-cart]").forEach(button => button.onclick = () => {
        try { addCartItem(data.products.find(p => p.id === button.dataset.addCart)); updateCartBadge(); cartNotice(grid.parentElement); }
        catch (err) { error(err.message); }
      });
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
    const catalogData = await catalog();
    const orderParams = new URLSearchParams(location.search);
    const cartMode = orderParams.get("from") === "order-list" || orderParams.get("cart") === "1" ||
      (!orderParams.get("product") && !orderParams.get("combo"));
    const cartLines = cartMode ? readCart(catalogData.products) : [];
    const data = { ...catalogData, products: catalogData.products.flatMap(p => {
      const variants = cartMode && isBikeKeyring(p) ? cartLines.filter(line => line.productId === p.id) : [];
      if (!variants.length) return [{ ...p, sourceProductId: p.id }];
      return variants.map((line, index) => ({ ...p, id: index ? p.id + "--cart-" + line.printSides : p.id,
        sourceProductId: p.id, checkoutSides: line.printSides }));
    }) };
    const state = new Map(
      data.products.map((p) => [p.id, { ...p, price: printPrice(p, p.checkoutSides || 1), quantity: 0, file: null, printSides: p.checkoutSides || 1, personalization: { bikeBrand: "", bikeNumber: "", ownerName: "", phone: "" }, backPhoto: null, nfc: {} }]),
    );
    const selected = orderParams.get("product");
    if (!cartMode && state.has(selected)) {
      const p = state.get(selected);
      p.quantity = 1;
      if (isBikeKeyring(p)) {
        p.printSides = new URLSearchParams(location.search).get("sides") === "2" ? 2 : 1;
        p.price = printPrice(data.products.find(item => item.id === p.id), p.printSides);
      }
    }
    const comboId = new URLSearchParams(location.search).get("combo"),
      selectedCombo = data.combos.find((c) => c.id === comboId && c.enabled);
    if (selectedCombo && !cartMode) {
      state.forEach((p) => (p.quantity = 0));
      selectedCombo.items.forEach((i) => {
        if (state.has(i.productId))
          state.get(i.productId).quantity = i.quantity;
      });
    }
    if (cartMode) {
      for (const line of cartLines) {
        const p = [...state.values()].find(p => p.sourceProductId === line.productId && (!isBikeKeyring(p) || p.printSides === line.printSides));
        if (p) p.quantity = line.quantity;
      }
    }
    // Checkout contains only items explicitly selected for this order.
    data.products = data.products.filter(p => state.get(p.id)?.quantity > 0);
    for (const id of state.keys()) if (!state.get(id).quantity) state.delete(id);
    if (!data.products.length) {
      form.innerHTML = '<div class="shop-notice" role="status"><p>অর্ডারের জন্য কোনো পণ্য বেছে নেওয়া হয়নি অথবা পণ্যটি এখন পাওয়া যাচ্ছে না।</p><a class="btn btn--primary" href="index.html#services">পণ্য বেছে নিন</a> <a class="btn btn--outline" href="order-list.html">অর্ডার তালিকা দেখুন</a></div>';
      return;
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
    function keyringFields(p) {
      const selected = state.get(p.id);
      return `<div class="keyring-customization"><label>প্রিন্টের ধরন<select data-print-sides="${e(p.id)}" class="form-control"><option value="1" ${selected.printSides === 1 ? "selected" : ""}>এক পাশে — ${money(p.price)}</option><option value="2" ${selected.printSides === 2 ? "selected" : ""}>দুই পাশে — ${money(p.doublePrice)}</option></select></label><fieldset data-keyring-fields="${e(p.id)}"><legend>কি রিংয়ে প্রিন্টের তথ্য</legend><label>বাইকের ব্র্যান্ডের নাম *<input class="form-control" data-keyring-field="bikeBrand" data-product-id="${e(p.id)}" maxlength="80" placeholder="যেমন: Royal Enfield" required></label><label>বাইকের নম্বর (ইংরেজিতে) *<input class="form-control" data-keyring-field="bikeNumber" data-product-id="${e(p.id)}" lang="en" maxlength="50" placeholder="DHAKA METRO HA 12-3456" required></label><label>নিজের নাম (ইংরেজিতে) *<input class="form-control" data-keyring-field="ownerName" data-product-id="${e(p.id)}" lang="en" maxlength="80" placeholder="YOUR NAME" required></label><label>কি রিংয়ে প্রিন্টের ফোন নম্বর *<input class="form-control" type="tel" inputmode="tel" data-keyring-field="phone" data-product-id="${e(p.id)}" maxlength="16" placeholder="01XXXXXXXXX" required></label><div data-back-photo-panel="${e(p.id)}" ${selected.printSides === 2 ? "" : "hidden"}><label>পেছনে নিজের ছবি (ঐচ্ছিক, সর্বোচ্চ ২ এমবি)<input type="file" data-back-photo="${e(p.id)}" accept="image/png,image/jpeg,image/webp"></label><p>ছবি দিলে দুই পাশে প্রিন্টের পেছনে ব্যবহার করা হবে।</p><span data-back-photo-name="${e(p.id)}" role="status"></span><img data-back-photo-preview="${e(p.id)}" alt="পেছনের ছবির প্রিভিউ" width="120" height="120" hidden><button type="button" class="btn btn--outline" data-remove-back-photo="${e(p.id)}">পেছনের ছবি সরান</button></div></fieldset></div>`;
    }
    function nfcFields(p) {
      return `<fieldset class="nfc-customization" data-nfc-fields="${e(p.id)}"><legend>NFC স্ক্যানের পর কী দেখাতে চান?</legend><p>নিজের বা প্রতিষ্ঠানের তথ্য দিন। যেসব লিংক দেখাতে চান শুধু সেগুলো পূরণ করুন। ডিজাইনের PDF/ছবি দেওয়া ঐচ্ছিক।</p>${Object.entries(nfcLabels).map(([key,label]) => `<label>${e(label)}${key === "displayName" ? " *" : " (ঐচ্ছিক)"}${["bio","other"].includes(key) ? `<textarea class="form-control" data-nfc-field="${key}" data-product-id="${e(p.id)}" maxlength="${key === "bio" ? 1500 : 3000}"></textarea>` : `<input class="form-control" data-nfc-field="${key}" data-product-id="${e(p.id)}" type="${key === "email" ? "email" : "text"}" maxlength="${["facebook","instagram","youtube","linkedin","website"].includes(key) ? 1000 : key === "email" ? 254 : key === "displayName" ? 120 : 150}" ${key === "displayName" ? "required" : ""}>`}</label>`).join("")}</fieldset>`;
    }
    const list = $(".product-option-list");
    list.innerHTML = data.products.length
      ? data.products
          .map(
            (p) =>
              `<section class="product-option-item"><div class="product-option-item__top"><div><small>${e(p.category)}</small><h3 class="product-option-item__name">${e(p.name)}</h3><p>${e(p.description)}</p></div><strong data-unit-price="${e(p.id)}">${money(state.get(p.id).price)}</strong></div><div class="product-option-item__controls"><div class="quantity-stepper"><button type="button" class="quantity-stepper__btn" data-minus="${e(p.id)}" aria-label="${e(p.name)} কমান">−</button><input class="quantity-stepper__input" data-quantity="${e(p.id)}" type="number" min="0" max="1000" value="${state.get(p.id).quantity}" aria-label="${e(p.name)} পরিমাণ"><button type="button" class="quantity-stepper__btn" data-plus="${e(p.id)}" aria-label="${e(p.name)} বাড়ান">+</button></div>${isNfc(p) ? nfcFields(p) : ""}${isBikeKeyring(p) ? keyringFields(p) : `<label>ডিজাইনের ফাইল (ঐচ্ছিক) (PDF / PNG / JPEG / WebP, সর্বোচ্চ ২ এমবি)<input type="file" data-artwork="${e(p.id)}" accept="application/pdf,image/png,image/jpeg,image/webp"><span data-filename="${e(p.id)}"></span></label><button class="btn btn--outline" type="button" data-remove-file="${e(p.id)}">ফাইল সরান</button>`}</div></section>`,
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
      "অর্ডার পাঠালে আপনার যোগাযোগের তথ্য ও ডিজাইন স্টুডিওর অর্ডার ব্যবস্থায় সংরক্ষিত হবে। এখানে অনলাইন পেমেন্ট নেওয়া হয় না।";
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
      const totals = calculateTotals(
          [...state.values()]
            .filter((p) => p.quantity > 0)
            .map((p) => ({ productId: p.id, quantity: p.quantity, printSides: p.printSides })),
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
              `<li class="summary-item"><div><strong>${e(p.name)}${isBikeKeyring(p) ? (p.printSides === 2 ? " · দুই পাশে প্রিন্ট" : " · এক পাশে প্রিন্ট") : ""}</strong><div>${p.quantity} × ${money(p.price)} ${p.file ? "· ফাইল সংযুক্ত" : ""}</div></div><span>${money(p.price * p.quantity)}</span></li>`,
          )
          .join("") || "<li>অন্তত একটি পণ্য বেছে নিন।</li>";
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
      list.querySelectorAll('[data-keyring-fields], [data-nfc-fields]').forEach(fieldset => {
        fieldset.disabled = state.get(fieldset.dataset.keyringFields || fieldset.dataset.nfcFields).quantity === 0 || busy || submitted;
      });
      submit.disabled = busy || submitted || !quantity;
    }
    list.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.removeBackPhoto) {
        const id = b.dataset.removeBackPhoto;
        state.get(id).backPhoto = null;
        list.querySelector(`[data-back-photo="${id}"]`).value = "";
        list.querySelector(`[data-back-photo-name="${id}"]`).textContent = "";
        const img = list.querySelector(`[data-back-photo-preview="${id}"]`);
        img.hidden = true;
        img.removeAttribute("src");
        update();
        return;
      }
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
    list.oninput = (ev) => {
      if (ev.target.dataset.nfcField) {
        state.get(ev.target.dataset.productId).nfc[ev.target.dataset.nfcField] = ev.target.value;
        return;
      }
      if (!ev.target.dataset.keyringField) return;
      const p = state.get(ev.target.dataset.productId);
      p.personalization[ev.target.dataset.keyringField] = ev.target.value;
    };
    list.onchange = async (ev) => {
      if (ev.target.dataset.printSides) {
        const id = ev.target.dataset.printSides, p = state.get(id);
        p.printSides = Number(ev.target.value);
        p.price = printPrice(data.products.find(item => item.id === id), p.printSides);
        list.querySelector(`[data-unit-price="${id}"]`).textContent = money(p.price);
        list.querySelector(`[data-back-photo-panel="${id}"]`).hidden = p.printSides !== 2;
        if (p.printSides !== 2) {
          p.backPhoto = null;
          list.querySelector(`[data-back-photo="${id}"]`).value = "";
          list.querySelector(`[data-back-photo-name="${id}"]`).textContent = "";
          const img = list.querySelector(`[data-back-photo-preview="${id}"]`);
          img.hidden = true; img.removeAttribute("src");
        }
        update();
        return;
      }
      if (ev.target.dataset.backPhoto) {
        const id = ev.target.dataset.backPhoto, p = state.get(id), file = ev.target.files[0];
        p.backPhoto = null;
        const img = list.querySelector(`[data-back-photo-preview="${id}"]`);
        img.hidden = true;
        img.removeAttribute("src");
        list.querySelector(`[data-back-photo-name="${id}"]`).textContent = "";
        if (!file) { update(); return; }
        busy = true; update();
        try {
          if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024)
            throw Error("পেছনের ছবির জন্য সর্বোচ্চ ২ এমবি PNG, JPEG বা WebP দিন।");
          const photoData = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(Error("ছবি পড়া যায়নি।")); reader.readAsDataURL(file);
          });
          const decoded = new Image(); decoded.src = photoData; await decoded.decode();
          p.backPhoto = { name: file.name, data: photoData };
          img.src = photoData; img.hidden = false;
          list.querySelector(`[data-back-photo-name="${id}"]`).textContent = file.name;
        } catch (err) { ev.target.value = ""; error(err.message); }
        finally { busy = false; update(); }
        return;
      }
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
            productId: p.sourceProductId || p.id,
            quantity: p.quantity,
            file: p.file,
            ...(isNfc(p) ? { nfc: p.nfc } : {}),
            ...(isBikeKeyring(p) ? { printSides: p.printSides, personalization: p.personalization, backPhoto: p.backPhoto } : {}),
          }));
      try {
        for (const item of items) if (isBikeKeyring(catalogData.products.find(p => p.id === item.productId))) Object.assign(item, keyringDetails(item));
      } catch (err) { error(err.message); return; }
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
      $("#shop-error")?.remove();
      busy = true;
      update();
      message.textContent = "অনুরোধ পাঠানো হচ্ছে…";
      try {
        requestId ||= crypto.randomUUID();
        const response = await apiFetch("/api/order-request", {
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
        const result = await readApiJson(response);
        if (!response.ok)
          throw Error(
            response.status === 400
              ? result.error || "তথ্য ও ফাইল যাচাই করুন। অনুমোদিত ফাইলের আকার সর্বোচ্চ ২ এমবি।"
              : "অনুরোধ পাঠানো যায়নি। পরে আবার চেষ্টা করুন।",
          );
        submitted = true;
        if (cartMode) { try { saveCart([]); updateCartBadge(); } catch {} }
        form.innerHTML = `<section class="order-success" role="status" tabindex="-1"><h2>✓ অর্ডার গ্রহণ করা হয়েছে</h2><p>আপনার অর্ডার নম্বরটি সংরক্ষণ করুন।</p><strong class="tracking-code">${e(result.id)}</strong><p>সর্বমোট: ${money(result.amount)}। অনলাইন পেমেন্ট নেওয়া হয়নি।</p><a class="btn btn--primary" href="track.html?code=${encodeURIComponent(result.id)}">অর্ডার ট্র্যাক করুন</a> <a class="btn btn--outline" href="index.html">হোমে ফিরুন</a></section>`;
        form.querySelector('.order-success').focus();
        form.scrollIntoView({behavior:"smooth",block:"start"});
      } catch (err) {
        error(err.message);
        message.textContent = "";
      } finally {
        busy = false;
        if (!submitted) update();
      }
    };
    update();
  }
  function initTracking() {
    const form = document.querySelector("#tracking-form");
    if (!form) return;
    const input = form.querySelector("input");
    input.value = new URLSearchParams(location.search).get("code") || "";
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector("button"), output = document.querySelector("#tracking-result");
      button.disabled = true; output.textContent = "অর্ডারের অবস্থা দেখা হচ্ছে…";
      try {
        const response = await apiFetch("/api/track", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tracking:input.value.trim()})});
        const result = await readApiJson(response);
        if (!response.ok) throw Error(result.error || "অর্ডার পাওয়া যায়নি।");
        output.innerHTML = `<h2>${e(result.id)}</h2>${statusBadge(result.status)}<p>অর্ডারের তারিখ: ${e(new Date(result.date).toLocaleString("bn-BD",{timeZone:"Asia/Dhaka"}))}</p>`;
      } catch (error) { output.textContent = error.message; }
      finally { button.disabled = false; }
    };
    if (input.value) form.requestSubmit();
  }
  initTracking();
  mobileMenu();
  initCartLinks();
  loadLiveCatalog().then(async () => {
    applyBusiness();
    applyPublicPricing();
    await Promise.all([storefront(), checkout(), cartPage()]);
  }).catch((err) => {
    error(err.message);
    document.querySelectorAll('#submitOrderBtn, button[type="submit"]').forEach(button => button.disabled = true);
  });
}
