# User Journey: intent-longbox

> **Superseded by 000-docs/033 for design purposes (E05 and E11); kept for its retailer language.** 033 §8 lists which journey steps hold and which are superseded, and why.

**Version:** 1.0.1

> Photo-to-listing pipeline for comic shops: snap a cover, identify the book, price it, draft the Shopify listing

**Author:** Jeremy Longshore
**Date:** 2026-09-01
**Status:** Approved (per doc 008)

## Personas

- **Shop employee** (the scanner): works the counter, knows comics well enough to eyeball a match and call out defects, has a phone in their pocket. Not expected to know grading scales, pricing data sources, or Shopify.
- **Owner** (the shop owner at Gotham City Limit for the pilot): reviews drafts, sets the pricing policy, publishes. Final say on everything customer-facing.

## Journey 1: Scanning a long box (shop employee)

1. **Stand at the long box.** Open the app in the phone browser. Tap "New scan."
2. **Snap the cover.** Take a photo of the front cover. If the book has a barcode (most books after 1990), snap that too, or get it in frame; the barcode alone often nails the exact issue, cover, and printing.
3. **Wait a beat.** The app reads the barcode if there is one, looks at the cover, and comes back with what it thinks the book is.
4. **Confirm.** What happens next depends on how sure the system is:
   - **Sure (high confidence):** one card: "Amazing Spider-Man #300, direct edition." Looks right? One tap, done.
   - **Pretty sure (medium):** a small grid of candidate covers. Tap the one in your hand. You have to pick; the app won't guess for you here.
   - **Not sure (low):** a search box. Type the title and issue like you'd tell a customer, pick from results.
   - If the model's own reading contradicts itself (says it read "#301" but ranked #300 first), the app never one-taps; it always shows you the choices.
5. **Call the condition.** No numbers, no grading exam. Pick the range that matches ("looks Fine to Very Fine") and tap the defects you see: spine ticks, corner wear, water stain, writing, whatever applies. That's it; the listing will say exactly that.
6. **See the price.** The app pulls recent comps and applies the shop's pricing rules to suggest an asking price. If the shop's rule says otherwise, or you know this book, you can adjust it, and the owner sees it before it ever goes live anyway.
7. **Done, next book.** The listing lands in Shopify as a DRAFT: title, issue, variant, condition wording, defects, price, your photo. Nothing is live. Grab the next book. A book should take well under a couple of minutes; the confirm tap is the slow part, and that's on purpose.

If the connection drops or the tab closes mid-book, the session is waiting in the list when you come back.

## Journey 2: Reviewing drafts (owner)

1. Open Shopify admin as usual. Drafts from today's scanning are sitting in products with DRAFT status; nothing has been published without you.
2. Skim each draft: identification, condition wording, price. The condition text is a range plus named defects, which is what you'd tell a customer over the counter anyway; there's never a bare number pretending to be a CGC grade.
3. Adjust price or copy if you want. Your pricing policy (say, a percent of recent comps with a floor and rounding) already shaped the suggestion, so most drafts should be publish-ready.
4. Publish the good ones. That's a normal Shopify action; the app never publishes for you.
5. Weekly during the pilot: a short review with us of what got corrected and why, so the bands and prompts get tuned. Your corrections are the training signal; you're not doing extra data-entry work to provide it.

## Journey 3: Correcting a wrong call

1. **Caught at confirm time (the normal case):** the employee just picks the right book from the grid or searches for it. That pick is recorded as the truth for that scan; the wrong candidate is kept as history, not erased. This is the system's main learning input and costs the employee nothing extra.
2. **Caught at owner review:** the owner fixes the draft in Shopify before publishing (or asks for a re-scan if the photo was bad). The correction is captured against the scan session so it counts in the accuracy numbers.
3. **Caught after publish (rare, since two humans saw it):** fix the live listing in Shopify as you would any listing; flag it in the weekly review so the miss gets a scan-session correction on record.
4. Nothing about a correction edits history. The original model call, its confidence, and the human's final answer all stay on record; that trail is exactly what tells us whether the system is getting better week over week.

## What the journeys deliberately avoid

- No login ceremony on the shop floor beyond what security requires; the employee flow is snap, tap, next.
- No grading quiz: ranges and defect checkboxes, in plain retail language.
- No auto-publish anywhere.
- No "the AI says" dead ends: every low-confidence or contradictory result lands in a normal search-and-pick flow the employee already understands.
