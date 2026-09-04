// The byte-level media guard: what a photograph must BE before it is allowed to
// become a file (E03-B07; 046 §3.3 B4, §4 B4, §5 A3, G-5, G-6).
//
// 046 E6 recorded the defect this file closes in one sentence: "the stored
// file's extension is chosen from the caller's declared mimetype, nothing ever
// reads the bytes, and the lie is then repeated to a third party" — a caller who
// sends `content-type: image/png` with arbitrary bytes got `.png` on disk and
// `image/png` announced to Anthropic. Everything below follows from refusing to
// believe the caller.
//
// FOUR PROPERTIES, IN THE ORDER THEY MATTER
//
//  1. **The type comes from the magic bytes.** The declared content type and the
//     client filename are read by nothing here. The detected type is what picks
//     the stored extension, which is what `readPhoto`'s closed `SERVABLE_TYPES`
//     map later turns back into a response content type — so the whole loop is
//     grounded in a fact about the bytes rather than in a claim about them.
//  2. **The container is walked, not sniffed.** A signature check alone accepts
//     the polyglot: PNG magic followed by an HTML document, or a valid JPEG with
//     a script appended after `EOI`. This walks every chunk/segment against a
//     CLOSED allowlist and refuses trailing bytes after the terminator, so a
//     file that carries a second document is `MALFORMED_IMAGE` rather than a
//     stored `.png` that a future misconfigured reader serves as text/html.
//  3. **Metadata is dropped on the way in.** The security half of G-6: EXIF,
//     XMP, Photoshop IRB and PNG text chunks never reach disk, so a phone's GPS
//     position and maker notes are gone before the bytes are a file (022 P7,
//     046 §5 A3). The seam is named at the bottom of this comment.
//  4. **Nothing is DECODED.** No pixel is reconstructed and no metadata parser
//     runs; the guard reads header FIELDS (PNG `IHDR`, JPEG `SOFn`, WebP
//     `VP8`/`VP8L`/`VP8X`) and copies or discards everything else byte for byte.
//
// WHY HAND-PARSED HEADERS AND NOT A LIBRARY (the decision this bead had to make).
// The obvious candidates each fail a requirement here. `sharp`/libvips and
// `image-size`-style decoders answer the dimension question by entering the
// image's own parsing machinery — libvips has had CVEs in exactly that path, and
// a decompression-bomb guard implemented by decoding the bomb is not a guard.
// `file-type` sniffs a signature and stops, which is property 1 without 2 or 3.
// `exif-parser`/`piexifjs` PARSE the metadata in order to remove it, which runs
// attacker-controlled TIFF structures through a parser to protect against
// attacker-controlled TIFF structures. What is actually needed is a byte
// classifier: read four length-prefixed header fields, copy the chunks on a
// closed list, drop the chunks on a second list, refuse everything else. That is
// small enough to read in one sitting and has no third-party attack surface, so
// it is written here with a fixture for every branch.
//
// ALSO DELIBERATELY ABSENT: any network call. The media path fetches nothing —
// no URL is read from a request, a file, or a database column on the way to or
// from disk, so there is no SSRF surface to constrain (046 §4 B4). That is
// asserted mechanically by `tests/contract/media-path-has-no-outbound-fetch.test.ts`
// rather than promised here.
//
// THE SEAM WITH E05-B07. G-6 assigns EXIF stripping to E05-B07 as part of a
// larger capture-and-normalisation job: orientation normalisation, resizing,
// derivative generation and the capture recipe. This file lands the SECURITY
// half only — metadata is DELETED, not interpreted, and nothing is re-encoded.
// When E05-B07 introduces a normalisation step it runs AFTER this guard on bytes
// that are already type-known, structure-checked and metadata-free.
//
// ONE CONSEQUENCE THAT E05-B07 INHERITS, STATED RATHER THAN LEFT TO BE
// DISCOVERED: the EXIF orientation tag is DROPPED HERE AND IS NOT CAPTURED.
// `MediaVerdict` does not carry it, deliberately — reading it means parsing the
// TIFF structure inside `APP1`, which is the attacker-controlled-metadata parser
// this file exists to avoid running, and doing it to protect against
// attacker-controlled metadata. So a phone that records a rotated frame plus an
// orientation tag has, after this guard, a rotated frame and no tag. That is
// SAFE (nothing renders sideways as a security problem) and it is a real
// product question for E05-B07, whose options are: normalise rotation on the
// CLIENT before upload — 035 §9 already records iOS EXIF-orientation behaviour
// as unsettled, and the capture recipe is E05-B07's anyway — or accept an
// orientation parser as a scoped, fuzzed exception with its own decision.
// **This bead does not choose.** It refuses to smuggle the choice in as a
// convenience field, and it refuses to promise a field it does not populate.

import { Transform, type TransformCallback } from "node:stream";

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** The three types the pipeline accepts, and the extension each is stored as. */
export const ACCEPTED_IMAGE_TYPES: Readonly<Record<ImageType, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/**
 * Why a rejection is a rejection. Each maps to one registry code in
 * `src/contracts/v1/errors.ts`; the mapping lives at the call site so this
 * module needs no HTTP vocabulary.
 */
export type MediaRejectionCode = "UNSUPPORTED_IMAGE_TYPE" | "MALFORMED_IMAGE" | "IMAGE_DIMENSIONS_TOO_LARGE";

/**
 * `reason` is developer English for a log and a test assertion. It NEVER reaches
 * a response body: 042 §4.3 rules that the server emits no prose a client could
 * render, so the envelope carries the registry's keyed message and this string
 * stays on this side of the wire.
 */
export class MediaRejected extends Error {
  constructor(
    readonly code: MediaRejectionCode,
    readonly reason: string
  ) {
    super(`${code}: ${reason}`);
    this.name = "MediaRejected";
  }
}

export interface MediaLimits {
  /** Total pixels (width × height) a stored image may carry. */
  readonly maxPixels: number;
  /** Ceiling on either dimension alone. */
  readonly maxDimension: number;
}

/**
 * PROVISIONAL, EXPLICITLY NON-EVIDENTIARY — the 042 §8.4 / A3 class of number.
 *
 * These are decompression-bomb floors, not measurements, and they are never
 * quoted as a capability, a capacity or a supported resolution in any artifact
 * at any class (021 B16). Derivation, stated so a later reader can move them
 * with evidence rather than by taste:
 *
 *   - 035 §9 records the device floor as an **iPhone SE-class 12 MP** camera and
 *     the mid-tier Android as a **Galaxy A56 50 MP** main sensor. 50 MP is the
 *     largest sensor any device in the pilot cohort carries.
 *   - `maxPixels` is **80 MP**, ≈1.6× that largest sensor: a phone photograph
 *     cannot reach it, and a device we have not surveyed has headroom.
 *   - `maxDimension` is **20,000 px** on either side, ≈2.5× the long edge of a
 *     50 MP 4:3 frame. It exists because area alone accepts a 1 × 400,000,000
 *     strip, and because a decoder given a 65,535-wide row allocates a row
 *     buffer before it allocates a frame.
 *
 * The bomb this stops is the classic one: a 25 KiB PNG whose `IHDR` declares
 * 64,000 × 64,000 (4.1 Gpx, ≈16 GB decoded). It is refused from the header, by
 * arithmetic, with no decoder ever asked to open it.
 */
export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  maxPixels: 80_000_000,
  maxDimension: 20_000,
};

/**
 * The storage quota, which is a different question from the per-file ceilings.
 *
 * 046 §4 B4 records "no per-tenant quota" beside the 25 MiB multipart limit: a
 * caller who cannot store a 26 MiB file can still store four hundred 24 MiB
 * ones, and the asset at risk is the host's disk (B12) rather than the request.
 * Two scopes, because they fail differently — a runaway phone client loops on
 * ONE session, and a hostile or misconfigured tenant grows a SHOP without any
 * single session looking unusual.
 *
 * PROVISIONAL, EXPLICITLY NON-EVIDENTIARY, same class as 042 §8.4: safety floors
 * set generously enough that ordinary counter work cannot reach them, never
 * quoted as a capacity or a supported volume (021 B16).
 *
 *   - `sessionPhotoLimit` **24**. 004's journey photographs one book per
 *     session: a cover, a barcode and defect frames. Two dozen is several times
 *     the most any one item plausibly needs and is reached in seconds by a loop.
 *   - `sessionByteLimit` **150 MiB** — six files at the 25 MiB per-file ceiling.
 *   - `shopPhotoLimit` **50,000** and `shopByteLimit` **50 GiB**. 035's pilot
 *     batches are hundreds of items, so this is orders of magnitude above the
 *     pilot; it exists so an unattended loop cannot fill the VPS volume 024 §4
 *     puts the uploads tree on.
 *
 * THE CEILING IS CHECKED BEFORE THE WRITE, ON THE USAGE THAT ALREADY EXISTS, so
 * a shop can exceed a byte ceiling **by at most one file per request in
 * flight** — k concurrent uploads that each read the same under-ceiling usage
 * each proceed, and the overshoot is k files rather than one (invariant review
 * of `1c25749`, item 4: the earlier "at most one file" was true serially and
 * only serially). That is deliberate and is not fixed by moving the check: the
 * only way to serialise it is to hold the transaction open across the disk
 * write, which 041 §4.1 forbids, and the trade is a bounded overshoot against a
 * side effect inside a retryable transaction. A quota is a floor against abuse,
 * not an accounting control.
 */
export interface MediaQuota {
  readonly sessionPhotoLimit: number;
  readonly sessionByteLimit: number;
  readonly shopPhotoLimit: number;
  readonly shopByteLimit: number;
}

export const DEFAULT_MEDIA_QUOTA: MediaQuota = {
  sessionPhotoLimit: 24,
  sessionByteLimit: 150 * 1024 * 1024,
  shopPhotoLimit: 50_000,
  shopByteLimit: 50 * 1024 * 1024 * 1024,
};

export type MediaPolicy = MediaLimits & MediaQuota;

export const DEFAULT_MEDIA_POLICY: MediaPolicy = { ...DEFAULT_MEDIA_LIMITS, ...DEFAULT_MEDIA_QUOTA };

/** Which ceiling a rejection hit. Structured `details`, never prose (042 §4.1). */
export interface QuotaBreach {
  readonly scope: "session" | "shop";
  readonly limit_kind: "count" | "bytes";
}

export interface MediaUsage {
  readonly sessionPhotos: number;
  readonly sessionBytes: number;
  readonly shopPhotos: number;
  readonly shopBytes: number;
}

/** The first ceiling `usage` has already reached, or `undefined`. */
export function quotaBreach(usage: MediaUsage, quota: MediaQuota): QuotaBreach | undefined {
  if (usage.sessionPhotos >= quota.sessionPhotoLimit) return { scope: "session", limit_kind: "count" };
  if (usage.sessionBytes >= quota.sessionByteLimit) return { scope: "session", limit_kind: "bytes" };
  if (usage.shopPhotos >= quota.shopPhotoLimit) return { scope: "shop", limit_kind: "count" };
  if (usage.shopBytes >= quota.shopByteLimit) return { scope: "shop", limit_kind: "bytes" };
  return undefined;
}

export interface MediaVerdict {
  readonly type: ImageType;
  /** Server-chosen, from the DETECTED type — never from the client filename. */
  readonly extension: string;
  readonly width: number;
  readonly height: number;
  /** Bytes written out (input minus dropped metadata). */
  readonly bytesOut: number;
  /** Bytes read in, for the quota accounting and for a truncation cross-check. */
  readonly bytesIn: number;
  /** True when at least one metadata chunk/segment was dropped. */
  readonly strippedMetadata: boolean;
  /**
   * WebP only. A RIFF header states the file's own length, and dropping an
   * `EXIF`/`XMP ` chunk changes it — so the four bytes at offset 4 must be
   * rewritten to `bytesOut - 8` once the length is known. Streaming cannot go
   * back, so the caller patches the file (or the buffer) afterwards. `undefined`
   * for the other two formats, which carry no total-length field.
   */
  readonly riffSizePatch?: number;
}

const EMPTY = Buffer.alloc(0);

interface FormatParser {
  /**
   * Consume as much of `buf` as possible, pushing bytes to keep through `emit`.
   * Returns the number of bytes consumed; the caller keeps the remainder.
   */
  pump(buf: Buffer, emit: (b: Buffer) => void): number;
  /** True once the format's terminator has been seen: any further byte is trailing. */
  readonly done: boolean;
  readonly width: number;
  readonly height: number;
  readonly strippedMetadata: boolean;
  /** Throws `MediaRejected` when the stream ended mid-structure. */
  assertComplete(): void;
}

// ---------------------------------------------------------------------------
// The sniffer
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF_PREFIX = Buffer.from("RIFF", "latin1");
const WEBP_PREFIX = Buffer.from("WEBP", "latin1");

/** Longest prefix any signature test needs: `RIFF` + size + `WEBP`. */
const SNIFF_BYTES = 12;

/**
 * The type of these bytes, from the bytes.
 *
 * `undefined` means "not enough bytes yet"; `null` means "none of the three".
 * The three-way answer matters because the caller is streaming: a 3-byte first
 * chunk is not yet a rejection.
 */
export function sniffImageType(head: Buffer): ImageType | null | undefined {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= SNIFF_BYTES) {
    if (
      head.subarray(0, 4).toString("latin1") === "RIFF" &&
      head.subarray(8, 12).toString("latin1") === "WEBP"
    ) {
      return "image/webp";
    }
    return null;
  }
  // Too short to decide. `undefined` only while the prefix is still consistent
  // with one of the three; a prefix that has already diverged is a rejection
  // now rather than after the whole body has been read.
  const n = head.length;
  const stillPng = n < 8 && head.equals(PNG_SIGNATURE.subarray(0, n));
  const stillJpeg = n < 3 && head.equals(JPEG_SIGNATURE.subarray(0, n));
  const stillWebp =
    head.subarray(0, Math.min(n, 4)).equals(RIFF_PREFIX.subarray(0, Math.min(n, 4))) &&
    (n <= 8 || head.subarray(8, n).equals(WEBP_PREFIX.subarray(0, n - 8)));
  return stillPng || stillJpeg || stillWebp ? undefined : null;
}

// ---------------------------------------------------------------------------
// PNG — chunk walk (spec: 8-byte signature, then `length | type | data | crc`)
// ---------------------------------------------------------------------------

/**
 * Chunks copied through. Everything here either IS the image (`IHDR`, `PLTE`,
 * `IDAT`, `IEND`) or is a small, bounded rendering hint whose content this guard
 * can account for (`tRNS`, `gAMA`, `cHRM`, `sRGB`, `bKGD`, `pHYs`, `sBIT`).
 *
 * `iCCP`, `sPLT` and `hIST` were on this list and have MOVED TO THE DROP SET
 * (invariant review of `1c25749`, item 2). Each is an unbounded blob with no
 * checkable magic — `iCCP` is a keyword, a NUL and a zlib stream, and a
 * passthrough nobody can verify is exactly the finding that review raised about
 * JPEG `APP2`. The JPEG answer was to keep the segment and check its
 * `ICC_PROFILE\0` identifier, because a JPEG colour profile is identified; the
 * PNG answer is to DROP, because the chunk is not, and because dropping cannot
 * fail an honest upload the way refusing would. Nothing rendering-relevant is
 * lost that `sRGB`/`gAMA`/`cHRM` do not already carry, and a phone does not
 * emit a palette histogram.
 */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "bKGD",
  "pHYs",
  "sBIT",
]);

/**
 * Chunks DROPPED. `tEXt`/`zTXt`/`iTXt` are the arbitrary-text chunks (and the
 * usual home of a smuggled HTML or SVG document); `eXIf` is the camera's EXIF
 * block verbatim, GPS included; `tIME` is a capture timestamp we hold in a
 * column instead.
 */
const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "iCCP", "sPLT", "hIST"]);

/** No single PNG chunk may declare more than this. The spec's own cap is 2^31-1. */
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

class PngParser implements FormatParser {
  private stage: "signature" | "chunkHeader" | "ihdr" | "copyBody" | "dropBody" | "trailing" = "signature";
  private remaining = 0;
  private sawIhdr = false;
  private sawIdat = false;
  width = 0;
  height = 0;
  strippedMetadata = false;
  done = false;

  constructor(private readonly limits: MediaLimits) {}

  pump(buf: Buffer, emit: (b: Buffer) => void): number {
    let off = 0;
    for (;;) {
      const left = buf.length - off;
      switch (this.stage) {
        case "signature": {
          if (left < 8) return off;
          emit(buf.subarray(off, off + 8));
          off += 8;
          this.stage = "chunkHeader";
          break;
        }
        case "chunkHeader": {
          if (left < 8) return off;
          const length = buf.readUInt32BE(off);
          const type = buf.subarray(off + 4, off + 8).toString("latin1");
          // ORDER MATTERS, AND THE REASON IS THE ERROR MESSAGE (invariant review
          // of `1c25749`, item 6). A file with a forged PNG signature and a
          // document behind it produces a nonsense chunk length AND a first
          // chunk that is not `IHDR`; the second is the true finding, so it is
          // tested first and a hostile file is refused for the right reason.
          if (!this.sawIhdr && type !== "IHDR") {
            throw new MediaRejected("MALFORMED_IMAGE", `png first chunk is ${type}, not IHDR`);
          }
          if (length > MAX_CHUNK_BYTES) {
            throw new MediaRejected("MALFORMED_IMAGE", `png chunk ${type} declares ${length} bytes`);
          }
          if (type === "IHDR") {
            if (this.sawIhdr) throw new MediaRejected("MALFORMED_IMAGE", "png has a second IHDR");
            if (length !== 13)
              throw new MediaRejected("MALFORMED_IMAGE", `png IHDR is ${length} bytes, not 13`);
            if (left < 8 + 13 + 4) return off;
            this.readIhdr(buf.subarray(off + 8, off + 8 + 13));
            emit(buf.subarray(off, off + 8 + 13 + 4));
            off += 8 + 13 + 4;
            this.sawIhdr = true;
            break;
          }
          if (type === "IEND") {
            if (!this.sawIdat) throw new MediaRejected("MALFORMED_IMAGE", "png has no IDAT chunk");
            if (length !== 0) throw new MediaRejected("MALFORMED_IMAGE", "png IEND carries data");
            if (left < 12) return off;
            emit(buf.subarray(off, off + 12));
            off += 12;
            this.stage = "trailing";
            this.done = true;
            break;
          }
          if (PNG_DROP.has(type)) {
            this.strippedMetadata = true;
            this.remaining = length + 4;
            this.stage = "dropBody";
            off += 8;
            break;
          }
          if (!PNG_KEEP.has(type)) {
            // The closed-allowlist refusal. An unrecognised chunk is content
            // nobody in this system understands, which is precisely the
            // condition under which "copy it through" is the wrong default —
            // APNG control chunks and every private chunk land here.
            throw new MediaRejected("MALFORMED_IMAGE", `png chunk ${type} is not on the allowlist`);
          }
          if (type === "IDAT") this.sawIdat = true;
          emit(buf.subarray(off, off + 8));
          off += 8;
          this.remaining = length + 4;
          this.stage = "copyBody";
          break;
        }
        case "copyBody":
        case "dropBody": {
          if (left === 0) return off;
          const take = Math.min(left, this.remaining);
          if (this.stage === "copyBody") emit(buf.subarray(off, off + take));
          off += take;
          this.remaining -= take;
          if (this.remaining === 0) this.stage = "chunkHeader";
          break;
        }
        case "trailing": {
          if (left === 0) return off;
          throw new MediaRejected("MALFORMED_IMAGE", `${left} bytes follow the png IEND chunk`);
        }
      }
    }
  }

  private readIhdr(body: Buffer): void {
    this.width = body.readUInt32BE(0);
    this.height = body.readUInt32BE(4);
    assertDimensions(this.width, this.height, this.limits, "png");
  }

  assertComplete(): void {
    if (!this.done) throw new MediaRejected("MALFORMED_IMAGE", "png ended before its IEND chunk");
  }
}

// ---------------------------------------------------------------------------
// JPEG — marker walk (spec: `SOI`, then segments, then entropy-coded scans, `EOI`)
// ---------------------------------------------------------------------------

/** The identifier every JPEG `APP2` ICC segment opens with (ICC.1, Annex B). */
const ICC_JPEG_IDENTIFIER = Buffer.from("ICC_PROFILE\0", "latin1");

/**
 * An ICC profile's own header signature, at byte 36 of the profile — the field
 * the specification calls `acsp`. It is what makes a WebP `ICCP` chunk
 * checkable where a PNG `iCCP` chunk (a keyword, a NUL and a zlib stream) is not.
 */
const ICC_PROFILE_SIGNATURE = Buffer.from("acsp", "latin1");
const ICC_PROFILE_SIGNATURE_OFFSET = 36;

/** Markers with no length field: `TEM` and the eight restart markers. */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/** Start-of-frame markers, which carry the dimensions. `C4`/`C8`/`CC` are not SOF. */
function isFrameMarker(marker: number): boolean {
  if (marker === 0xc4 || marker === 0xc8 || marker === 0xcc) return false;
  return marker >= 0xc0 && marker <= 0xcf;
}

/**
 * Segments DROPPED: `APP1` (EXIF — the GPS block — and XMP), `APP3`–`APP13`
 * (maker notes, Photoshop IRB with its IPTC payload, and the vendor grab-bag),
 * `APP15`, and `COM` (a free-text comment: the JPEG equivalent of PNG `tEXt`).
 *
 * `APP0` (JFIF), `APP2` (ICC colour profile) and `APP14` (Adobe colour
 * transform) are KEPT: all three are needed to render the image correctly and
 * none carries device provenance or free text. `APP2` is additionally REQUIRED
 * TO PROVE IT IS ONE — see the `ICC_PROFILE\0` check in the segment stage.
 */
function isDroppedSegment(marker: number): boolean {
  if (marker === 0xe1 || marker === 0xef || marker === 0xfe) return true;
  return marker >= 0xe3 && marker <= 0xed;
}

function isKeptSegment(marker: number): boolean {
  if (marker === 0xe0 || marker === 0xe2 || marker === 0xee) return true; // APP0, APP2, APP14
  if (marker === 0xc4 || marker === 0xcc) return true; // DHT, DAC
  if (marker >= 0xda && marker <= 0xdf) return true; // SOS, DQT, DNL, DRI, DHP, EXP
  return isFrameMarker(marker);
}

class JpegParser implements FormatParser {
  private stage: "soi" | "marker" | "segment" | "copyBody" | "dropBody" | "scan" | "trailing" = "soi";
  private marker = 0;
  private remaining = 0;
  private sawFrame = false;
  private sawScan = false;
  width = 0;
  height = 0;
  strippedMetadata = false;
  done = false;

  constructor(private readonly limits: MediaLimits) {}

  pump(buf: Buffer, emit: (b: Buffer) => void): number {
    let off = 0;
    for (;;) {
      const left = buf.length - off;
      switch (this.stage) {
        case "soi": {
          if (left < 2) return off;
          emit(buf.subarray(off, off + 2));
          off += 2;
          this.stage = "marker";
          break;
        }
        case "marker": {
          if (left < 2) return off;
          if (buf[off] !== 0xff) {
            throw new MediaRejected(
              "MALFORMED_IMAGE",
              `jpeg expected a marker, found 0x${buf[off]!.toString(16)}`
            );
          }
          const marker = buf[off + 1]!;
          if (marker === 0xff) {
            // Fill byte: legal padding before a marker.
            emit(buf.subarray(off, off + 1));
            off += 1;
            break;
          }
          if (marker === 0xd9) {
            if (!this.sawScan) throw new MediaRejected("MALFORMED_IMAGE", "jpeg reached EOI with no scan");
            emit(buf.subarray(off, off + 2));
            off += 2;
            this.stage = "trailing";
            this.done = true;
            break;
          }
          if (marker === 0xd8) throw new MediaRejected("MALFORMED_IMAGE", "jpeg carries a second SOI");
          if (isStandaloneMarker(marker)) {
            emit(buf.subarray(off, off + 2));
            off += 2;
            break;
          }
          if (!isKeptSegment(marker) && !isDroppedSegment(marker)) {
            throw new MediaRejected(
              "MALFORMED_IMAGE",
              `jpeg marker 0x${marker.toString(16)} is not on the allowlist`
            );
          }
          // The two marker bytes are NOT consumed here. A segment's marker and
          // its length field are emitted (or dropped) together, and a chunk
          // boundary can fall between them — so the marker stays in the pending
          // buffer until `segment` has the whole 4-byte head.
          this.marker = marker;
          this.stage = "segment";
          break;
        }
        case "segment": {
          if (left < 4) return off;
          const length = buf.readUInt16BE(off + 2);
          if (length < 2)
            throw new MediaRejected("MALFORMED_IMAGE", `jpeg segment length ${length} is impossible`);
          const bodyLength = length - 2;
          if (isFrameMarker(this.marker)) {
            // ONE FRAME HEADER, AND THE SECOND IS A REFUSAL — symmetric with the
            // second-`IHDR` rule above, and for the same reason.
            //
            // THIS IS THE BUG THE INVARIANT REVIEW OF `1c25749` CAUGHT, and it
            // was a bomb bypass rather than an untidiness. The dimensions were
            // read from the FIRST `SOFn` and every later one was copied through
            // unchecked, so `SOF0 8×8` followed by `SOF2 64000×64000` — or by a
            // second `SOF0` after the scan — was accepted as an 8×8 image with
            // the 4.1 Gpx frame header sitting in the stored file, where the
            // next decoder to open it reads the header it was handed rather
            // than the one this guard measured. Checking every frame instead of
            // the first would have closed the arithmetic and left the file
            // self-contradictory, which is the shape that produces the next
            // bug; a camera emits exactly ONE frame header (a progressive JPEG
            // has one `SOF2` and many scans, which this still accepts), so a
            // second one is not a picture with two sizes — it is a file we
            // cannot describe, and the closed-allowlist rule already says what
            // to do with that.
            if (this.sawFrame) {
              throw new MediaRejected("MALFORMED_IMAGE", "jpeg carries a second frame header");
            }
            // A frame header is at most a few hundred bytes; buffer it whole so
            // the dimensions are read from one contiguous slice.
            if (bodyLength < 5) throw new MediaRejected("MALFORMED_IMAGE", "jpeg SOF header is too short");
            if (left < 4 + bodyLength) return off;
            const body = buf.subarray(off + 4, off + 4 + bodyLength);
            this.height = body.readUInt16BE(1);
            this.width = body.readUInt16BE(3);
            assertDimensions(this.width, this.height, this.limits, "jpeg");
            this.sawFrame = true;
            emit(buf.subarray(off, off + 4 + bodyLength));
            off += 4 + bodyLength;
            this.stage = "marker";
            break;
          }
          if (this.marker === 0xe2) {
            // APP2 IS KEPT AND IS THEREFORE CHECKED (invariant review of
            // `1c25749`, item 2). A colour profile is grading evidence and worth
            // keeping, but "APP2" alone says only that a segment exists — an
            // APP2 carrying an HTML document was copied through intact. The
            // segment must now open with the `ICC_PROFILE\0` identifier the ICC
            // specification requires, which is the same move the WebP bitstream
            // start-code checks make: a kept blob has to say what it is.
            //
            // Buffered whole rather than streamed, like the frame header above:
            // a JPEG segment is at most 65,533 bytes, and an identifier that is
            // checked across a chunk boundary is an identifier that can be
            // checked wrong.
            if (bodyLength < ICC_JPEG_IDENTIFIER.length) {
              throw new MediaRejected("MALFORMED_IMAGE", "jpeg APP2 is too short to carry an ICC identifier");
            }
            if (left < 4 + bodyLength) return off;
            const identifier = buf.subarray(off + 4, off + 4 + ICC_JPEG_IDENTIFIER.length);
            if (!identifier.equals(ICC_JPEG_IDENTIFIER)) {
              throw new MediaRejected("MALFORMED_IMAGE", "jpeg APP2 is not an ICC profile");
            }
            emit(buf.subarray(off, off + 4 + bodyLength));
            off += 4 + bodyLength;
            this.stage = "marker";
            break;
          }
          if (isDroppedSegment(this.marker)) {
            this.strippedMetadata = true;
            this.remaining = bodyLength;
            this.stage = "dropBody";
            off += 4;
            break;
          }
          if (this.marker === 0xda) {
            if (!this.sawFrame)
              throw new MediaRejected("MALFORMED_IMAGE", "jpeg scan precedes its frame header");
            this.sawScan = true;
          }
          emit(buf.subarray(off, off + 4));
          off += 4;
          this.remaining = bodyLength;
          this.stage = "copyBody";
          break;
        }
        case "copyBody":
        case "dropBody": {
          if (left === 0) return off;
          const take = Math.min(left, this.remaining);
          if (this.stage === "copyBody") emit(buf.subarray(off, off + take));
          off += take;
          this.remaining -= take;
          if (this.remaining === 0) this.stage = this.marker === 0xda ? "scan" : "marker";
          break;
        }
        case "scan": {
          // Entropy-coded data. A literal 0xFF inside it is byte-stuffed as
          // `FF 00`, and `FF D0`–`FF D7` are restart markers that belong to the
          // scan — so the first `FF` that is neither is the next real marker.
          if (left === 0) return off;
          let i = off;
          let atMarker = false;
          while (i < buf.length) {
            if (buf[i] !== 0xff) {
              i += 1;
              continue;
            }
            if (i + 1 >= buf.length) break; // hold the trailing 0xFF for the next chunk
            const next = buf[i + 1]!;
            if (next === 0xff) {
              // Fill padding: the SECOND 0xFF may still begin the real marker.
              i += 1;
              continue;
            }
            if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
              i += 2;
              continue;
            }
            atMarker = true;
            break;
          }
          if (i > off) emit(buf.subarray(off, i));
          off = i;
          if (!atMarker) return off;
          this.stage = "marker";
          break;
        }
        case "trailing": {
          if (left === 0) return off;
          throw new MediaRejected("MALFORMED_IMAGE", `${left} bytes follow the jpeg EOI marker`);
        }
      }
    }
  }

  assertComplete(): void {
    if (!this.done) throw new MediaRejected("MALFORMED_IMAGE", "jpeg ended before its EOI marker");
  }
}

// ---------------------------------------------------------------------------
// WebP — RIFF chunk walk
// ---------------------------------------------------------------------------

/** `VP8X` feature flags, from libwebp's `WebPFeatureFlags`. */
const WEBP_XMP_FLAG = 0x04;
const WEBP_EXIF_FLAG = 0x08;
const WEBP_ANIMATION_FLAG = 0x02;

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP"]);
const WEBP_DROP = new Set(["EXIF", "XMP "]);

class WebpParser implements FormatParser {
  private stage: "riff" | "chunkHeader" | "prefix" | "copyBody" | "dropBody" | "trailing" = "riff";
  private fourcc = "";
  private remaining = 0;
  private prefixNeeded = 0;
  private prefix: Buffer = EMPTY;
  private riffRemaining = 0;
  private sawBitstream = false;
  width = 0;
  height = 0;
  strippedMetadata = false;
  done = false;

  constructor(private readonly limits: MediaLimits) {}

  pump(buf: Buffer, emit: (b: Buffer) => void): number {
    let off = 0;
    for (;;) {
      const left = buf.length - off;
      switch (this.stage) {
        case "riff": {
          if (left < 12) return off;
          const declared = buf.readUInt32LE(off + 4);
          if (declared < 4) throw new MediaRejected("MALFORMED_IMAGE", "webp RIFF size is impossible");
          this.riffRemaining = declared - 4;
          emit(buf.subarray(off, off + 12));
          off += 12;
          this.stage = "chunkHeader";
          break;
        }
        case "chunkHeader": {
          if (this.riffRemaining === 0) {
            this.stage = "trailing";
            this.done = true;
            break;
          }
          if (left < 8) return off;
          this.fourcc = buf.subarray(off, off + 4).toString("latin1");
          const size = buf.readUInt32LE(off + 4);
          if (size > MAX_CHUNK_BYTES) {
            throw new MediaRejected("MALFORMED_IMAGE", `webp chunk ${this.fourcc} declares ${size} bytes`);
          }
          const padded = size + (size % 2);
          if (padded + 8 > this.riffRemaining) {
            throw new MediaRejected("MALFORMED_IMAGE", `webp chunk ${this.fourcc} overruns the RIFF size`);
          }
          this.riffRemaining -= padded + 8;
          if (WEBP_DROP.has(this.fourcc)) {
            this.strippedMetadata = true;
            this.remaining = padded;
            this.stage = "dropBody";
            off += 8;
            break;
          }
          if (!WEBP_KEEP.has(this.fourcc)) {
            throw new MediaRejected("MALFORMED_IMAGE", `webp chunk ${this.fourcc} is not on the allowlist`);
          }
          this.remaining = padded;
          this.prefixNeeded = headerPrefixBytes(this.fourcc);
          if (this.prefixNeeded > 0) {
            if (this.prefixNeeded > padded) {
              throw new MediaRejected("MALFORMED_IMAGE", `webp chunk ${this.fourcc} is truncated`);
            }
            emit(buf.subarray(off, off + 8));
            off += 8;
            this.prefix = EMPTY;
            this.stage = "prefix";
            break;
          }
          emit(buf.subarray(off, off + 8));
          off += 8;
          this.stage = "copyBody";
          break;
        }
        case "prefix": {
          if (left === 0) return off;
          const take = Math.min(left, this.prefixNeeded - this.prefix.length);
          this.prefix = Buffer.concat([this.prefix, buf.subarray(off, off + take)]);
          off += take;
          if (this.prefix.length < this.prefixNeeded) return off;
          const header = this.readHeaderPrefix(this.fourcc, Buffer.from(this.prefix));
          emit(header);
          this.remaining -= this.prefixNeeded;
          this.stage = "copyBody";
          break;
        }
        case "copyBody":
        case "dropBody": {
          if (this.remaining === 0) {
            this.stage = "chunkHeader";
            break;
          }
          if (left === 0) return off;
          const take = Math.min(left, this.remaining);
          if (this.stage === "copyBody") emit(buf.subarray(off, off + take));
          off += take;
          this.remaining -= take;
          break;
        }
        case "trailing": {
          if (left === 0) return off;
          throw new MediaRejected("MALFORMED_IMAGE", `${left} bytes follow the webp RIFF payload`);
        }
      }
    }
  }

  /**
   * Read the dimensions out of a bitstream header — and, for `VP8X`, clear the
   * EXIF and XMP feature bits, because the chunks they point at are dropped and
   * a flag that promises a chunk which is not there is a malformed file.
   */
  private readHeaderPrefix(fourcc: string, prefix: Buffer): Buffer {
    if (fourcc === "ICCP") {
      const signature = prefix.subarray(
        ICC_PROFILE_SIGNATURE_OFFSET,
        ICC_PROFILE_SIGNATURE_OFFSET + ICC_PROFILE_SIGNATURE.length
      );
      if (!signature.equals(ICC_PROFILE_SIGNATURE)) {
        throw new MediaRejected("MALFORMED_IMAGE", "webp ICCP is not an ICC profile");
      }
      return prefix;
    }
    if (fourcc === "VP8X") {
      const flags = prefix[0]!;
      if ((flags & WEBP_ANIMATION_FLAG) !== 0) {
        throw new MediaRejected("MALFORMED_IMAGE", "webp is animated");
      }
      if ((flags & (WEBP_EXIF_FLAG | WEBP_XMP_FLAG)) !== 0) this.strippedMetadata = true;
      prefix[0] = flags & ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG);
      this.width = prefix.readUIntLE(4, 3) + 1;
      this.height = prefix.readUIntLE(7, 3) + 1;
      assertDimensions(this.width, this.height, this.limits, "webp");
      return prefix;
    }
    if (fourcc === "VP8 ") {
      if (prefix[3] !== 0x9d || prefix[4] !== 0x01 || prefix[5] !== 0x2a) {
        throw new MediaRejected("MALFORMED_IMAGE", "webp VP8 keyframe header is missing its start code");
      }
      this.sawBitstream = true;
      if (this.width === 0) {
        this.width = prefix.readUInt16LE(6) & 0x3fff;
        this.height = prefix.readUInt16LE(8) & 0x3fff;
        assertDimensions(this.width, this.height, this.limits, "webp");
      }
      return prefix;
    }
    // VP8L: `0x2f`, then 14 bits of (width-1) and 14 bits of (height-1).
    if (prefix[0] !== 0x2f) {
      throw new MediaRejected("MALFORMED_IMAGE", "webp VP8L header is missing its signature");
    }
    this.sawBitstream = true;
    const bits = prefix.readUInt32LE(1);
    if (this.width === 0) {
      this.width = (bits & 0x3fff) + 1;
      this.height = ((bits >> 14) & 0x3fff) + 1;
      assertDimensions(this.width, this.height, this.limits, "webp");
    }
    return prefix;
  }

  assertComplete(): void {
    if (!this.done)
      throw new MediaRejected("MALFORMED_IMAGE", "webp ended before its RIFF payload was consumed");
    // A `VP8X` header alone declares a canvas with no picture in it. The
    // dimensions being known is not the same fact as the image existing.
    if (!this.sawBitstream) throw new MediaRejected("MALFORMED_IMAGE", "webp carries no bitstream chunk");
  }
}

/** How many payload bytes each webp chunk needs buffered to read its header. */
function headerPrefixBytes(fourcc: string): number {
  if (fourcc === "VP8X") return 10;
  if (fourcc === "VP8 ") return 10;
  if (fourcc === "VP8L") return 5;
  // `ICCP` is KEPT and is therefore checked, exactly as JPEG `APP2` is: enough
  // of the profile to reach its own `acsp` signature (invariant review item 2).
  if (fourcc === "ICCP") return ICC_PROFILE_SIGNATURE_OFFSET + ICC_PROFILE_SIGNATURE.length;
  return 0;
}

function assertDimensions(width: number, height: number, limits: MediaLimits, format: string): void {
  if (width < 1 || height < 1) {
    throw new MediaRejected("MALFORMED_IMAGE", `${format} declares ${width}x${height}`);
  }
  if (width > limits.maxDimension || height > limits.maxDimension || width * height > limits.maxPixels) {
    throw new MediaRejected(
      "IMAGE_DIMENSIONS_TOO_LARGE",
      `${format} declares ${width}x${height} (${width * height} pixels)`
    );
  }
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * One upload's worth of validation and sanitisation, fed incrementally.
 *
 * It holds only the bytes it cannot yet classify — a chunk header, a frame
 * header, a `VP8X` prefix — so a 25 MiB photograph costs a chunk of heap and not
 * a copy of the file. That is the same property `readPhoto` protects on the way
 * out, applied on the way in.
 */
export class ImageSanitizer {
  private pending: Buffer = EMPTY;
  private parser?: FormatParser;
  private type?: ImageType;
  private bytesIn = 0;
  private bytesOut = 0;

  constructor(private readonly limits: MediaLimits = DEFAULT_MEDIA_LIMITS) {}

  update(chunk: Buffer): Buffer {
    this.bytesIn += chunk.length;
    const buf = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    if (!this.parser) {
      const detected = sniffImageType(buf);
      if (detected === null) {
        throw new MediaRejected("UNSUPPORTED_IMAGE_TYPE", "the bytes match no accepted image signature");
      }
      if (detected === undefined) {
        this.pending = buf;
        return EMPTY;
      }
      this.type = detected;
      this.parser =
        detected === "image/png"
          ? new PngParser(this.limits)
          : detected === "image/jpeg"
            ? new JpegParser(this.limits)
            : new WebpParser(this.limits);
    }
    const out: Buffer[] = [];
    const consumed = this.parser.pump(buf, (b) => {
      if (b.length > 0) out.push(Buffer.from(b));
    });
    this.pending = consumed === buf.length ? EMPTY : buf.subarray(consumed);
    const emitted = out.length === 1 ? out[0]! : Buffer.concat(out);
    this.bytesOut += emitted.length;
    return emitted;
  }

  finish(): MediaVerdict {
    if (!this.parser || !this.type) {
      throw new MediaRejected("UNSUPPORTED_IMAGE_TYPE", "the bytes match no accepted image signature");
    }
    this.parser.assertComplete();
    if (this.pending.length > 0) {
      throw new MediaRejected("MALFORMED_IMAGE", `${this.pending.length} bytes were left unparsed`);
    }
    return {
      type: this.type,
      extension: ACCEPTED_IMAGE_TYPES[this.type],
      width: this.parser.width,
      height: this.parser.height,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      strippedMetadata: this.parser.strippedMetadata,
      ...(this.type === "image/webp" ? { riffSizePatch: this.bytesOut - 8 } : {}),
    };
  }
}

/**
 * The sanitiser as a `Transform`, for the upload pipeline.
 *
 * The verdict is read from `sanitizer` after the pipeline resolves; a rejection
 * surfaces as the stream's error, which the caller maps to a registry code.
 */
export function createImageSanitizer(limits: MediaLimits = DEFAULT_MEDIA_LIMITS): {
  stream: Transform;
  finish: () => MediaVerdict;
} {
  const sanitizer = new ImageSanitizer(limits);
  const stream = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      try {
        cb(null, sanitizer.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      } catch (err) {
        cb(err as Error);
      }
    },
  });
  return { stream, finish: () => sanitizer.finish() };
}

/**
 * Whole-buffer convenience: the same guard, run to completion, with the WebP
 * RIFF length already patched. Used by the unit tests and by any caller that
 * genuinely holds the bytes; the upload path streams instead.
 */
export function sanitizeImage(
  input: Buffer,
  limits: MediaLimits = DEFAULT_MEDIA_LIMITS
): { verdict: MediaVerdict; bytes: Buffer } {
  const sanitizer = new ImageSanitizer(limits);
  const bytes = Buffer.concat([sanitizer.update(input)]);
  const verdict = sanitizer.finish();
  if (verdict.riffSizePatch !== undefined) bytes.writeUInt32LE(verdict.riffSizePatch, 4);
  return { verdict, bytes };
}
