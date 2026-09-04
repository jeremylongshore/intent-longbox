/* Longbox minimal phone UI. Ugly is fine; working flow matters. */
const $ = (id) => document.getElementById(id);
const GRADES = ["PR", "FR", "GD", "VG", "FN", "VF", "NM"];
const DEFECTS = [
  "spine_ticks",
  "spine_roll",
  "corner_wear",
  "cover_crease",
  "foxing",
  "tanning",
  "water_damage",
  "writing",
  "tears",
  "detached_cover",
  "missing_pages",
  "restoration",
];

let shopId = null;
let sessionId = null;
let candidates = [];
let selectedCandidate = null;

function status(msg) {
  $("status").textContent = msg;
}
function api(path) {
  return `/api/shops/${shopId}${path}`;
}
function show(id) {
  $(id).classList.remove("hidden");
}
function hide(id) {
  $(id).classList.add("hidden");
}

async function loadShops() {
  const res = await fetch("/api/shops");
  const data = await res.json();
  const sel = $("shop-select");
  sel.innerHTML = "";
  for (const s of data.shops) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  }
  if (data.shops.length === 0) status("No shops registered. Run: pnpm register-shop");
}

$("start-btn").onclick = async () => {
  shopId = $("shop-select").value;
  if (!shopId) return status("Pick a shop first.");
  const res = await fetch(api("/scan-sessions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const data = await res.json();
  if (!res.ok) return status(JSON.stringify(data));
  sessionId = data.session.id;
  show("photo-section");
  status(`Session ${sessionId} started.`);
};

async function uploadPhoto(input, kind) {
  if (!input.files || input.files.length === 0) return false;
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", input.files[0]);
  const res = await fetch(api(`/scan-sessions/${sessionId}/photos`), { method: "POST", body: fd });
  if (!res.ok) {
    status(`photo upload failed: ${await res.text()}`);
    return false;
  }
  return true;
}

$("identify-btn").onclick = async () => {
  status("Uploading photos…");
  const haveCover = await uploadPhoto($("cover-input"), "cover");
  await uploadPhoto($("barcode-input"), "barcode");
  if (!haveCover) return status("A cover photo is required.");
  status("Identifying… (model call)");
  const body = {};
  const digits = $("barcode-digits").value.trim();
  if (digits) body.barcode_digits = digits;
  const res = await fetch(api(`/scan-sessions/${sessionId}/identify`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return status(`identify failed: ${JSON.stringify(data)}`);
  renderCandidates(data);
};

// Band copy — registered verbatim in 000-docs/021 §3.1 (C1 high, C2 medium,
// C3 low + contradiction). Band words only, never a number: 022 P6, 019 §2.
const BAND_COPY = {
  high: { heading: "Best match", body: "Check the cover in your hand." },
  medium: { heading: "Close matches", body: "More than one book fits. Pick the one in your hand." },
  low: { heading: "Not sure enough to guess", body: "Search for it — type what's on the cover." },
};
const CONTRADICTION_TEXT =
  "The barcode and the cover don't agree. Check the issue number before you confirm.";

function renderCandidates(data) {
  candidates = data.candidates || [];
  selectedCandidate = null;
  show("candidates-section");
  const copy = BAND_COPY[data.band] || BAND_COPY.low;
  $("band-line").innerHTML =
    `<span class="band ${data.band}">${copy.heading}</span><div class="band-body">${copy.body}</div>`;
  // Cost is an owner-facing figure (cost_log), never shown on the operator
  // screen — 022 P8. It stays in the immutable llm_rerank / cost_log record.
  $("contradiction-line").textContent = data.contradiction ? CONTRADICTION_TEXT : "";
  const list = $("candidate-list");
  list.innerHTML = "";
  hide("manual-search");
  hide("confirm-btn");
  hide("override-link");

  // No confidence figure in the label — band words only (022 P6; 021 C1-C3).
  const label = (c) =>
    `${c.title} #${c.issue}${c.variant ? " (" + c.variant + ")" : ""} — ${c.publisher || "?"} ${c.year || ""}`;

  if (data.band === "high" && !data.contradiction && candidates.length > 0) {
    // one-tap confirm
    const c = candidates[0];
    const div = document.createElement("div");
    div.className = "candidate selected";
    div.textContent = label(c);
    list.appendChild(div);
    selectedCandidate = c;
    const btn = $("confirm-btn");
    btn.textContent = "Yes, that's the book";
    btn.onclick = () => confirmIssue(c, "one_tap");
    show("confirm-btn");
    const overrideLink = $("override-link");
    if (overrideLink) {
      overrideLink.textContent = "Not this one — show other matches";
      overrideLink.onclick = (e) => {
        e.preventDefault();
        renderCandidateGrid(data, "grid_pick");
      };
      show("override-link");
    }
  } else if ((data.band === "medium" || data.band === "high") && candidates.length > 0) {
    // A high band that arrives with a contradiction (the server downgrades it today; this
    // is belt and braces for locked decision 7) is forced to a pick, never to one-tap.
    renderCandidateGrid(data, "grid_pick");
  } else {
    // low band: manual search box
    list.innerHTML = "<p>" + copy.body + "</p>";
    for (const c of candidates) {
      const div = document.createElement("div");
      div.className = "candidate";
      div.textContent = "Maybe: " + label(c);
      div.onclick = () => {
        $("manual-title").value = c.title || "";
        $("manual-issue").value = c.issue || "";
        $("manual-publisher").value = c.publisher || "";
      };
      list.appendChild(div);
    }
    show("manual-search");
    $("manual-confirm-btn").onclick = () =>
      confirmIssue(
        {
          title: $("manual-title").value,
          issue: $("manual-issue").value,
          publisher: $("manual-publisher").value,
        },
        "manual_search"
      );
  }
}

// Forced grid pick, shared by the medium band and the high-band override
// link (021 C1: "Not this one — show other matches" reveals the full list).
function renderCandidateGrid(data, confirmSource) {
  hide("override-link");
  const list = $("candidate-list");
  list.innerHTML = "";
  selectedCandidate = null;
  hide("confirm-btn");
  const label = (c) =>
    `${c.title} #${c.issue}${c.variant ? " (" + c.variant + ")" : ""} — ${c.publisher || "?"} ${c.year || ""}`;
  candidates.forEach((c, i) => {
    const div = document.createElement("div");
    div.className = "candidate" + (i === 0 ? " closest" : "");
    div.textContent = (i === 0 ? "Closest match: " : "") + label(c);
    div.onclick = () => {
      document.querySelectorAll(".candidate").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      selectedCandidate = c;
      show("confirm-btn");
    };
    list.appendChild(div);
  });
  const btn = $("confirm-btn");
  btn.textContent = "Confirm selected";
  btn.onclick = () => selectedCandidate && confirmIssue(selectedCandidate, confirmSource);
}

async function confirmIssue(issue, source) {
  const res = await fetch(api(`/scan-sessions/${sessionId}/confirm`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, source }),
  });
  const data = await res.json();
  if (!res.ok) return status(`confirm failed: ${JSON.stringify(data)}`);
  selectedCandidate = issue;
  status("Confirmed.");
  initCondition();
  show("condition-section");
  $("price-query").value = `${issue.title || ""} ${issue.issue || ""}`.trim();
}

function initCondition() {
  for (const id of ["grade-low", "grade-high"]) {
    const sel = $(id);
    if (sel.options.length) continue;
    for (const g of GRADES) {
      const o = document.createElement("option");
      o.value = g;
      o.textContent = g;
      sel.appendChild(o);
    }
  }
  $("grade-low").value = "VG";
  $("grade-high").value = "FN";
  const box = $("defect-boxes");
  if (!box.children.length) {
    for (const d of DEFECTS) {
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox" value="${d}"> ${d.replace(/_/g, " ")}`;
      box.appendChild(l);
    }
  }
}

$("condition-btn").onclick = async () => {
  const defects = [...document.querySelectorAll("#defect-boxes input:checked")].map((i) => i.value);
  const res = await fetch(api(`/scan-sessions/${sessionId}/condition`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grade_range_low: $("grade-low").value,
      grade_range_high: $("grade-high").value,
      defects,
    }),
  });
  const data = await res.json();
  if (!res.ok) return status(`condition failed: ${JSON.stringify(data)}`);
  status("Condition saved.");
  show("price-section");
};

const SOURCE_LABELS = {
  ebay: "eBay — live asks",
  pricecharting: "PriceCharting — historical FMV",
};

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

$("price-btn").onclick = async () => {
  // Structured query from the confirmed issue; the editable text box is the
  // title fallback when the employee tweaks it.
  const body = { title: $("price-query").value };
  if (selectedCandidate && selectedCandidate.issue) body.issue = String(selectedCandidate.issue);
  if (selectedCandidate && selectedCandidate.variant) body.variant = String(selectedCandidate.variant);
  const overrideDollars = parseFloat($("price-override").value);
  if (!Number.isNaN(overrideDollars)) body.override_cents = Math.round(overrideDollars * 100);
  const res = await fetch(api(`/scan-sessions/${sessionId}/price`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return status(`price failed: ${JSON.stringify(data)}`);

  // Side-by-side source cards: eBay live asks vs PriceCharting historical.
  const wrap = $("price-sources");
  wrap.innerHTML = "";
  for (const s of data.sources) {
    const card = document.createElement("div");
    card.className = "price-source" + (s.source === data.driven_by ? " driving" : "");
    const name = document.createElement("div");
    name.className = "src-name";
    name.textContent = SOURCE_LABELS[s.source] || s.source;
    card.appendChild(name);
    const detail = document.createElement("div");
    if (s.status === "failed") {
      detail.innerHTML = `<span class="src-failed">unavailable</span>`;
    } else if (s.stub) {
      detail.innerHTML = `<span class="src-stub">STUB — no credentials</span>`;
    } else if (s.comps_count === 0) {
      detail.textContent = "no comps found";
    } else {
      detail.textContent = `${s.comps_count} comps · low ${dollars(s.summary.low_cents)} · median ${dollars(s.summary.median_cents)} · high ${dollars(s.summary.high_cents)}`;
    }
    card.appendChild(detail);
    if (s.source === data.driven_by) {
      const tag = document.createElement("div");
      tag.textContent = "drives suggested price";
      card.appendChild(tag);
    }
    wrap.appendChild(card);
  }

  const drivenBy =
    data.driven_by === "policy_floor"
      ? "shop policy floor (no real comps)"
      : SOURCE_LABELS[data.driven_by] || data.driven_by;
  $("price-result").textContent = `Suggested: ${dollars(data.suggested_cents)} — from ${drivenBy}`;
  show("draft-section");
};

$("draft-btn").onclick = async () => {
  status("Creating Shopify draft…");
  const res = await fetch(api(`/scan-sessions/${sessionId}/draft`), { method: "POST" });
  const data = await res.json();
  if (!res.ok) return status(`draft failed: ${JSON.stringify(data)}`);
  $("draft-result").textContent =
    `DRAFT created: ${data.draft.product_gid}${data.stub ? " (STUB — no Shopify creds)" : ""}`;
  status("Done. Start another scan when ready.");
};

loadShops();
