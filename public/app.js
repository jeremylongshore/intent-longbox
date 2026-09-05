/* Longbox minimal phone UI. Ugly is fine; working flow matters.
 *
 * E02-D08 moved this client onto the v1 contract, in the SAME PR as the server
 * change, because 042 A4 makes that a constraint rather than a courtesy: split
 * across two PRs, either the client reads fields the server no longer sends, or
 * the server keeps sending `confidence`, `provider`, `model` and `costUsd`
 * "because the client still needs them" — and the second is how a temporary
 * state becomes permanent.
 *
 * FOUR THINGS CHANGED HERE:
 *   1. every path carries `/api/v1`;
 *   2. every write carries an `Idempotency-Key`, MINTED WHEN THE OPERATOR ACTS
 *      and replayed unchanged (042 §5.6) — the key is a fact about the act, not
 *      about the attempt;
 *   3. every write carries `against`: the id of the record the operator was
 *      actually looking at (042 §6). A `409 STALE_WORLD_VIEW` re-reads the
 *      session and mints a NEW key, because a retry that changes its mind is a
 *      new act (042 A9);
 *   4. no error body is rendered. The server emits DEVELOPER English and this
 *      screen selects its own words from `error.code` (042 §4.3, 022 P6) — so a
 *      validation blob and a provider exception can no longer reach a person
 *      standing at a long box.
 */
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
/**
 * The highest-witness record this screen has shown the operator (042 §6.1):
 * `{table, id}`, sent with every write so the server can refuse one made against
 * a world that has moved. Updated when a write succeeds and when identify
 * returns the row it wrote.
 */
let against = null;

/**
 * Operator-facing copy, selected from the envelope's `code`. Every string here
 * is the client's, never the server's `message` — 042 §4.3 makes that
 * structural, and 022 P6 is the rule underneath it: errors say what to do next,
 * and a screen never blames the person.
 *
 * These are MINIMAL truthful wordings, not 021-registered copy. The registered
 * strings are E05's under 021's T26 pre-send step; what this table fixes is that
 * the server has no say in them.
 */
const ERROR_COPY = {
  STALE_WORLD_VIEW: "Someone else answered this one. Reloading what the shop has now.",
  SESSION_IS_TERMINAL: "This scan is closed. Start a new one for this book.",
  WRITE_CONFLICT_RETRY_EXHAUSTED: "The shop was busy. Try that again.",
  CONTRADICTION_BLOCKS_ONE_TAP: "The barcode and the cover don't agree. Pick the book from the list.",
  // E06-D01 / 040 v1.3.0 F3. A DIFFERENT sentence from the one above, because a
  // different thing happened: nothing on the cover disagreed — we could not read
  // enough of it to be sure. Telling an operator "the barcode and the cover don't
  // agree" when they do not disagree is a lie that costs trust the first time
  // they check.
  ONE_TAP_NOT_CORROBORATED: "Not enough of the cover was readable to be sure. Pick the book from the list.",
  SESSION_HAS_NO_CONFIRMATION: "Confirm the book first.",
  SESSION_HAS_NO_PRICING: "Price the book first.",
  SESSION_HAS_NO_CONDITION: "Record the condition first.",
  SHOP_HAS_NO_PRICING_POLICY: "This shop has no pricing rules set up yet.",
  PHOTO_TOO_LARGE: "That photo is too big. Take it again.",
  // E03-B07. Four refusals a person can act on, and each says the ONE thing
  // they should do next. None of them says why the file was refused: an
  // operator at the counter cannot act on "the container had a chunk outside
  // the allowlist", and 021 has not registered these strings yet — E05 owes
  // them, exactly as it owes the rows above.
  UNSUPPORTED_IMAGE_TYPE: "That file isn't a photo. Take the picture again with the camera.",
  MALFORMED_IMAGE: "That photo didn't come through cleanly. Take it again.",
  IMAGE_DIMENSIONS_TOO_LARGE: "That photo is too big to store. Take it again with the normal camera setting.",
  PHOTO_QUOTA_EXCEEDED:
    "This scan already has all the photos it can hold. Start a new scan for the next book.",
  RATE_LIMITED: "Too many requests just now. Try again in a moment.",
  IDENTIFY_FAILED: "Couldn't read that one. Search for it instead.",
  IDENTIFY_PROVIDER_UNAVAILABLE: "Couldn't read that one. Search for it instead.",
  IDEMPOTENCY_KEY_REUSED: "That looked like a repeat of something different. Start the step again.",
  VALIDATION_FAILED: "Something in that entry didn't fit. Check it and try again.",
  SESSION_NOT_FOUND: "That scan isn't there any more.",
  SHOP_NOT_FOUND: "That shop isn't there any more.",
  // E03-D09 (048 §6.1, §3.5, §9.3). Three sentences that say WHAT TO DO NEXT and
  // never what went wrong: 022 P6, and 048 §9.3's constant answer means this
  // screen genuinely cannot tell an expired session from a stolen one from a
  // cross-site attempt — so it must not pretend to.
  SESSION_REQUIRED: "This phone needs to be set up for the shop. Ask the owner.",
  OPERATOR_REQUIRED: "Tap your name to carry on.",
  // E03-B03. The person is signed in and their role does not cover this — so
  // the sentence says what to do (ask somebody who can) and never why, because
  // "why" here is the shop's own staffing and not this screen's business. It
  // does NOT appear for a wrong location: that answers as an unknown shop, on
  // purpose (054 §3.3).
  PERMISSION_DENIED: "This is not something your role can do. Ask the owner or a manager.",
  PIN_INVALID: "That didn't work. Try again in a moment.",
  // E03-D07 (048 §7). Same discipline: the server answers ONE code for an
  // unknown, spent, expired or wrong-shop code, so this screen cannot tell them
  // apart and must not guess. It says the one thing that is true in every case
  // and that a person at a counter can act on — ask for another code.
  // ⚠ ONE CODE, TWO SITUATIONS, AND THIS SENTENCE IS WRONG FOR ONE OF THEM.
  // 048 §9.3 makes the server answer INVITATION_INVALID identically for an
  // unknown, spent, expired or cross-shop code AND for a shop inside its
  // redemption delay — which is the point, because a screen that could tell them
  // apart would be the oracle the constant answer exists to remove. But "ask the
  // owner for a new one" is an INSTRUCTION, and it is the wrong instruction for
  // the delay: a new code will not help, and it spends an owner's time issuing
  // one. So the copy names the action that is right in both cases and leaves the
  // cause unsaid — which is what the client can honestly do with one code.
  // **The registered string is E05's under 021's T26 pre-send** and this is not
  // it; the constraint is recorded here so the next author does not "improve" it
  // back into a diagnosis the server did not make.
  INVITATION_INVALID: "That code didn't work. Wait a moment and try again, or ask the owner for a new one.",
  ENROLLMENT_CODE_INVALID:
    "That setup code didn't work. Wait a moment and try again, or ask the owner for a new one.",
  // The one refusal on the redemption screen that is NOT about a secret the
  // server holds: it is about the six digits the person just chose, so it can say
  // what to do without disclosing anything. It does not list the rules — 048 §3.5
  // keeps the denylist at set time precisely so nobody can read it off a screen.
  PIN_REFUSED: "Choose a different PIN. Not repeated digits, not in order, and not the shop's own numbers.",
  INTERNAL_ERROR: "Something went wrong on our side. Try again.",
};
const FALLBACK_COPY = "Something went wrong. Try again.";

/** `error.code` to this screen's words. The body itself is never rendered. */
function copyFor(data) {
  const code = data && data.error && data.error.code;
  return ERROR_COPY[code] || FALLBACK_COPY;
}

/**
 * A key is minted per ACT and reused for every retry OF THAT ACT (042 §5.6). A
 * key minted at replay would make two replays of one act two different requests,
 * which is exactly the duplication 019 T23 signs at zero.
 */
function newKey() {
  return crypto.randomUUID();
}

/** Every write goes through here: one key, one `against`, one error path. */
async function write(path, body, opts = {}) {
  const res = await fetch(api(path), {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": opts.key || newKey() },
    body: JSON.stringify(against && !opts.noAgainst ? { ...body, against } : body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (res.ok) return { ok: true, data };
  if (data && data.error && data.error.code === "STALE_WORLD_VIEW") {
    // 042 A9: refreshing and re-submitting is a NEW ACT under a NEW key, and
    // this is the one path where getting that wrong hands the operator a 422 for
    // doing exactly the right thing.
    await refreshWorldView();
  }
  status(copyFor(data));
  return { ok: false, data };
}

/** Re-read the session and adopt its current highest witness as `against`. */
async function refreshWorldView() {
  if (!sessionId) return;
  const res = await fetch(api(`/scan-sessions/${sessionId}`));
  if (!res.ok) return;
  const body = await res.json();
  const events = body.events || {};
  const ladder = [
    "shopify_draft",
    "pricing_snapshot",
    "condition_assessment",
    "human_confirmation",
    "llm_rerank",
    "candidate_set",
    "scan_photo",
  ];
  against = null;
  for (const table of ladder) {
    const rows = events[table] || [];
    if (rows.length > 0) {
      against = { table, id: rows[rows.length - 1].id };
      break;
    }
  }
}

function status(msg) {
  $("status").textContent = msg;
}
function api(path) {
  return `/api/v1/shops/${shopId}${path}`;
}
function show(id) {
  $(id).classList.remove("hidden");
}
function hide(id) {
  $(id).classList.add("hidden");
}

async function loadShops() {
  const res = await fetch("/api/v1/shops");
  if (!res.ok) return false;
  const data = await res.json();
  const sel = $("shop-select");
  sel.innerHTML = "";
  for (const s of data.shops || []) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  }
  // E03-D08: this list is now *MY SHOPS* (048 §6.4 v1.3.0) — what this session
  // may act on, not what exists. The old copy said "No shops registered. Run:
  // pnpm register-shop", which named a command an operator does not have and
  // cannot run — 022 P5's "never blame the person holding the phone".
  //
  // **AND THERE ARE TWO CAUSES, NOT ONE.** The device-only branch reads the
  // shop by the session's own enrollment id and therefore always returns exactly
  // one row, so an empty list on a phone with NO operator signed in means the
  // enrollment has not finished. Once somebody IS signed in, the query is the
  // membership-rooted branch, and empty means THIS PERSON's access to this shop
  // was removed — a different sentence and a different next action. Saying
  // "not set up yet" to somebody whose access was revoked sends them to fix a
  // phone that is fine.
  if (!data.shops || data.shops.length === 0) {
    status(
      operatorName
        ? "This phone is set up, but your access to this shop is not active right now. The owner can turn it back on."
        : "This phone is not set up for a shop yet. Ask the owner to finish setting it up."
    );
  }
  return true;
}

/* ---------------------------------------------------------------------------
 * WHO IS HOLDING THE PHONE (E03-D09; 048 §3.5, §3.6, I7)
 *
 * TWO PRINCIPALS, TWO COOKIES, AND THE BROWSER HOLDS BOTH. This screen never
 * reads a token: both cookies are `HttpOnly`, `Secure`, `SameSite=Strict` and
 * `__Host-` prefixed, so page script cannot see them and a sibling subdomain
 * cannot set them. Everything below is about which SCREEN to show, never about
 * which credential to send.
 *
 * The device session says which shop the phone belongs to and lives for weeks.
 * The operator session says who is holding it and lives for the gap between two
 * customers. Switching operator is one tap and six digits — never an email and a
 * password — because 022 P2 makes friction on this path a design defect and
 * 033 A13 requires no re-login between books.
 *
 * WHAT THIS SCREEN MAY NOT SHOW (022 P3, 019 T35 non-waivable): a count, a
 * timestamp, a "last used", a badge, a streak, or any per-person datum beside a
 * name. The server does not send one; this screen does not invent one.
 * ------------------------------------------------------------------------- */

let operatorName = null;
let pendingOperator = null;

async function loadOperators() {
  const res = await fetch("/api/v1/operators");
  if (!res.ok) return false;
  const data = await res.json();
  const list = $("operator-list");
  list.innerHTML = "";
  // Defensive `|| []`: a response whose shape is not the one declared is a
  // response this screen shows nothing for. It never throws at a person standing
  // at a long box, and it never renders a field it was not promised.
  for (const person of data.operators || []) {
    const row = el("div", "candidate", person.display_name);
    row.onclick = () => askForPin(person);
    list.appendChild(row);
  }
  if (!data.operators || data.operators.length === 0) {
    list.appendChild(el("p", null, "Nobody is set up for this shop yet. Ask the owner."));
  }
  return true;
}

function askForPin(person) {
  pendingOperator = person;
  $("pin-prompt").textContent = `${person.display_name} — enter your code`;
  $("pin-input").value = "";
  show("pin-entry");
  $("pin-input").focus();
}

$("pin-cancel-btn").onclick = () => {
  pendingOperator = null;
  hide("pin-entry");
};

$("pin-btn").onclick = async () => {
  if (!pendingOperator) return;
  const res = await fetch("/api/v1/operator-sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": newKey() },
    body: JSON.stringify({ app_user_id: pendingOperator.id, pin: $("pin-input").value }),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // ONE sentence for every refusal — a wrong code, an unknown pair, a code
    // still inside its growing delay. The server answers the same thing for all
    // of them (048 §9.3) and this screen must not pretend to know more than it
    // was told.
    $("pin-input").value = "";
    return status(copyFor(data));
  }
  operatorName = data.operator.display_name;
  pendingOperator = null;
  hide("pin-entry");
  hide("operator-section");
  $("signed-in-name").textContent = `Signed in: ${operatorName}`;
  show("signed-in-section");
  show("shop-section");
  await loadShops();
  status("Ready.");
};

$("switch-operator-btn").onclick = async () => {
  await fetch("/api/v1/operator-sessions/end", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": newKey() },
    body: JSON.stringify({}),
  });
  // The DEVICE session survives: the next person is one tap and a code away,
  // and the phone never loses its enrollment (048 §3.5, 033 A13).
  operatorName = null;
  hide("signed-in-section");
  hide("shop-section");
  show("operator-section");
  await loadOperators();
  status("");
};

/**
 * What loads first, and what each failure means.
 *
 * No device session at all → the phone has not been set up for a shop, and the
 * fix is an owner with an enrollment code, not anything this screen can do. The
 * copy says exactly that and stops.
 */
async function boot() {
  const hasDevice = await loadOperators();
  if (!hasDevice) {
    show("operator-section");
    $("operator-list").innerHTML = "";
    $("operator-list").appendChild(
      el("p", null, "This phone is not set up for a shop yet. Ask the owner to set it up.")
    );
    return;
  }
  show("operator-section");
}

$("start-btn").onclick = async () => {
  shopId = $("shop-select").value;
  if (!shopId) return status("Pick a shop first.");
  against = null;
  const out = await write("/scan-sessions", {}, { noAgainst: true });
  if (!out.ok) return;
  sessionId = out.data.session.id;
  // A new book gets a clean strip: the previous session's photographs are not
  // this one's evidence. `innerHTML = ""` is the one permitted assignment
  // (E03-D03) — it clears nodes and parses nothing.
  $("photo-previews").innerHTML = "";
  show("photo-section");
  status("Scan started.");
};

async function uploadPhoto(input, kind) {
  if (!input.files || input.files.length === 0) return false;
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", input.files[0]);
  const res = await fetch(api(`/scan-sessions/${sessionId}/photos`), {
    method: "POST",
    headers: { "idempotency-key": newKey() },
    body: fd,
  });
  if (!res.ok) {
    // Never render the raw body: that was the path a provider's exception and a
    // validation blob reached an operator (042 E12).
    status(copyFor(await res.json().catch(() => null)));
    return false;
  }
  const body = await res.json().catch(() => null);
  if (body && body.photo && body.photo.id) showPreview(body.photo.id, kind);
  return true;
}

/**
 * Show what the counter just photographed (E03-D05).
 *
 * The `src` is the TENANT-SCOPED route — `/api/v1/shops/<shop>/scan-sessions/
 * <session>/photos/<id>` — and never `/uploads/…`, which no longer exists. That
 * mount published every shop's photographs to anyone with a URL (046 §3.3 B5),
 * and this screen was its only real consumer, which is why deleting it cost one
 * `img` src rather than a subsystem.
 *
 * The id comes from the upload's own response, so this builds no path from
 * anything a person typed.
 */
function showPreview(photoId, kind) {
  const strip = $("photo-previews");
  if (!strip) return;
  const img = document.createElement("img");
  img.className = "preview";
  img.alt = kind === "barcode" ? "Barcode photo just taken" : "Cover photo just taken";
  img.src = api(`/scan-sessions/${sessionId}/photos/${photoId}`);
  strip.appendChild(img);
}

$("identify-btn").onclick = async () => {
  status("Uploading photos…");
  // Clear WITHIN the session too, not only at "New scan": tapping Identify twice
  // uploads two more photos and used to append two more thumbnails beside the
  // first pair, so the strip stopped meaning "what this book looks like" and
  // started meaning "everything you have ever taken here".
  $("photo-previews").innerHTML = "";
  const haveCover = await uploadPhoto($("cover-input"), "cover");
  await uploadPhoto($("barcode-input"), "barcode");
  if (!haveCover) return status("A cover photo is required.");
  status("Looking it up…");
  const body = {};
  const digits = $("barcode-digits").value.trim();
  if (digits) body.barcode_digits = digits;
  const out = await write(`/scan-sessions/${sessionId}/identify`, body);
  if (!out.ok) return;
  // 042 §6.3: the response carries the id of the record the operator is about to
  // be shown, which is what lets the confirm below say what it answered.
  const data = out.data;
  if (data.llm_rerank_id) against = { table: "llm_rerank", id: data.llm_rerank_id };
  else if (data.candidate_set_ids.length > 0) {
    against = { table: "candidate_set", id: data.candidate_set_ids[data.candidate_set_ids.length - 1] };
  }
  renderCandidates(data);
};

/**
 * Build one element with a class and its text (E03-D03).
 *
 * Every place this screen used to assemble markup as a string now goes through
 * here. `textContent` is the whole point: a `<script>` in a title becomes eleven
 * visible characters and never a node, whatever the catalog, the model or the
 * server put in the string.
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The band as a class-safe token.
 *
 * The band is a server field. This screen already selects its COPY from it via a
 * declared table, and the class name is the one place the raw value used to
 * travel — so it is confined to the three words the design actually has, and an
 * unrecognised value renders as `low` rather than as whatever arrived.
 */
function bandOf(data) {
  return BAND_COPY[data.band] ? data.band : "low";
}

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
  if (data.manual_path) status("Working from manual entry for now.");
  selectedCandidate = null;
  show("candidates-section");
  const copy = BAND_COPY[data.band] || BAND_COPY.low;
  // E03-D03 (046 §11 I14): built as NODES, not as a string. This line used to
  // interpolate `data.band` — a SERVER-derived value — into a class attribute
  // inside `innerHTML`, which is markup assembled from a field this screen does
  // not control. `el(...)` sets `textContent` and `className` through the DOM,
  // where a string is a string and can never become an element.
  const bandLine = $("band-line");
  bandLine.innerHTML = "";
  bandLine.appendChild(el("span", `band ${bandOf(data)}`, copy.heading));
  bandLine.appendChild(el("div", "band-body", copy.body));
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
    list.appendChild(el("p", null, copy.body));
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

/**
 * The six fields the v1 contract's `confirmedIssue` declares, as strings.
 *
 * E03-D02: the one-tap path used to post the model's candidate object WHOLE, and
 * the server accepted it whole (`z.record(z.unknown())`). Now the schema is
 * `.strict()`, so the client states the same six fields the server declares —
 * which is the point of a contract, and is why this function exists rather than
 * a spread. Numbers (a `year` from the model) become strings here rather than
 * being coerced at the edge: a bounded string is the same fact with fewer rules.
 */
function boundedIssue(issue) {
  const out = {};
  for (const field of ["title", "issue", "variant", "publisher", "year", "upc"]) {
    const value = issue[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    out[field] = String(value);
  }
  return out;
}

async function confirmIssue(issue, source) {
  const out = await write(`/scan-sessions/${sessionId}/confirm`, { issue: boundedIssue(issue), source });
  if (!out.ok) {
    // A re-rank that did not reach the high band refuses the one-tap and forces
    // the grid (040 v1.3.0 F3, as amended by E06-D01: the refusal keys on the
    // BAND, and a contradiction is one of five causes). The server states it as a
    // CODE, and this screen turns either code into the forced pick rather than
    // parsing a sentence.
    const code = out.data && out.data.error && out.data.error.code;
    if (code === "CONTRADICTION_BLOCKS_ONE_TAP" || code === "ONE_TAP_NOT_CORROBORATED") {
      renderCandidateGrid({ band: "medium", contradiction: true }, "grid_pick");
    }
    return;
  }
  against = { table: "human_confirmation", id: out.data.confirmation.id };
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
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = d;
      l.appendChild(input);
      l.appendChild(document.createTextNode(` ${d.replace(/_/g, " ")}`));
      box.appendChild(l);
    }
  }
}

$("condition-btn").onclick = async () => {
  const defects = [...document.querySelectorAll("#defect-boxes input:checked")].map((i) => i.value);
  const out = await write(`/scan-sessions/${sessionId}/condition`, {
    grade_range_low: $("grade-low").value,
    grade_range_high: $("grade-high").value,
    defects,
  });
  if (!out.ok) return;
  against = { table: "condition_assessment", id: out.data.assessment.id };
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
  const out = await write(`/scan-sessions/${sessionId}/price`, body);
  if (!out.ok) return;
  const data = out.data;
  const driving = (data.sources || []).find((s) => s.source === data.driven_by);
  if (driving && driving.snapshot_id) against = { table: "pricing_snapshot", id: driving.snapshot_id };

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
      detail.appendChild(el("span", "src-failed", "unavailable"));
    } else if (s.stub) {
      detail.appendChild(el("span", "src-stub", "STUB — no credentials"));
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

// The draft is now a JOB, not a call this request waits on (043 §4.1, §4.2).
// The server answers 202 with the id of the queued work; a worker performs the
// Shopify mutation afterwards.
//
// THE COPY SAYS "BEING CREATED", NEVER "CREATED". 043 §4.2 is explicit that the
// one thing which must not degrade when the effect goes asynchronous is honesty
// of the screen: the operator is told the listing is being created and never
// that it exists, because at this moment it does not. This is the minimal
// truthful wording; the REGISTERED copy is E05's under 021's T26 pre-send step
// (043 §9.3), and this is not it.
//
// 022 P4 is the reason the trade is acceptable rather than an obstacle to it: an
// operator at a long box wants the next book, not a Shopify product id.
$("draft-btn").onclick = async () => {
  status("Requesting the listing…");
  const out = await write(`/scan-sessions/${sessionId}/draft`, {});
  if (!out.ok) return;
  $("draft-result").textContent =
    "Requested. The listing is being created — it will appear in Shopify as a draft for the owner to review.";
  status("Done. Start another scan when ready.");
};

// A boot failure is a screen that says what to do next, never an unhandled
// rejection in a console nobody at a shop counter is looking at (022 P6).
boot().catch(() => status(FALLBACK_COPY));
