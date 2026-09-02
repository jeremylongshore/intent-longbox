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

function renderCandidates(data) {
  candidates = data.candidates || [];
  selectedCandidate = null;
  show("candidates-section");
  $("band-line").innerHTML =
    `Confidence band: <span class="band ${data.band}">${data.band.toUpperCase()}</span> (${(data.confidence * 100).toFixed(0)}%) — cost $${data.costUsd.toFixed(4)}`;
  $("contradiction-line").textContent = data.contradiction
    ? `Evidence check flagged this — please verify: ${data.contradictionReasons.join("; ")}`
    : "";
  const list = $("candidate-list");
  list.innerHTML = "";
  hide("manual-search");
  hide("confirm-btn");

  const label = (c) =>
    `${c.title} #${c.issue}${c.variant ? " (" + c.variant + ")" : ""} — ${c.publisher || "?"} ${c.year || ""} [${(c.confidence * 100).toFixed(0)}%]`;

  if (data.band === "high" && candidates.length > 0) {
    // one-tap confirm
    const c = candidates[0];
    const div = document.createElement("div");
    div.className = "candidate selected";
    div.textContent = label(c);
    list.appendChild(div);
    selectedCandidate = c;
    const btn = $("confirm-btn");
    btn.textContent = "Yes, that's it (one tap)";
    btn.onclick = () => confirmIssue(c, "one_tap");
    show("confirm-btn");
  } else if (data.band === "medium" && candidates.length > 0) {
    // forced grid pick
    for (const c of candidates) {
      const div = document.createElement("div");
      div.className = "candidate";
      div.textContent = label(c);
      div.onclick = () => {
        document.querySelectorAll(".candidate").forEach((el) => el.classList.remove("selected"));
        div.classList.add("selected");
        selectedCandidate = c;
        show("confirm-btn");
      };
      list.appendChild(div);
    }
    const btn = $("confirm-btn");
    btn.textContent = "Confirm selected";
    btn.onclick = () => selectedCandidate && confirmIssue(selectedCandidate, "grid_pick");
  } else {
    // low band: manual search box
    list.innerHTML = "<p>Low confidence — enter the book manually.</p>";
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

$("price-btn").onclick = async () => {
  const body = { query: $("price-query").value };
  const overrideDollars = parseFloat($("price-override").value);
  if (!Number.isNaN(overrideDollars)) body.override_cents = Math.round(overrideDollars * 100);
  const res = await fetch(api(`/scan-sessions/${sessionId}/price`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return status(`price failed: ${JSON.stringify(data)}`);
  $("price-result").textContent =
    `Suggested: $${(data.suggested_cents / 100).toFixed(2)} (${data.comps_count} comps${data.stub ? ", STUB — no PriceCharting token" : ""})`;
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
