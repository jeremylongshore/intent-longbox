// The upload guard, branch by branch (E03-B07; 046 E6, E7, G-5, G-6).
//
// One test per decision the guard can make, each driven by fixture bytes from
// `tests/fixtures/media/`. The negative cases are the point: a control with no
// asserted failing case is a control nobody has seen work.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEDIA_LIMITS,
  DEFAULT_MEDIA_QUOTA,
  ImageSanitizer,
  MediaRejected,
  quotaBreach,
  sanitizeImage,
  sniffImageType,
  type MediaRejectionCode,
} from "../src/services/media.js";
import {
  ELF_BINARY,
  GIF_IMAGE,
  HTML_DOCUMENT,
  PDF_DOCUMENT,
  SVG_DOCUMENT,
  jpeg,
  jpegCommentSegment,
  jpegExifSegment,
  jpegFakeIccSegment,
  jpegFrameSegment,
  jpegIccSegment,
  jpegMarkers,
  jpegPhotoshopSegment,
  png,
  pngChunk,
  pngChunkTypes,
  pngExifChunk,
  pngIdat,
  pngTextChunk,
  webp,
  webpAnimChunk,
  webpChunkFourccs,
  webpExifChunk,
  webpIccpChunk,
  webpVp8Chunk,
  webpVp8xChunk,
  webpXmpChunk,
} from "./fixtures/media/index.js";

/** Run the guard and return the rejection code, or `undefined` when it passed. */
function reject(bytes: Buffer, limits = DEFAULT_MEDIA_LIMITS): MediaRejectionCode | undefined {
  try {
    sanitizeImage(bytes, limits);
    return undefined;
  } catch (err) {
    if (err instanceof MediaRejected) return err.code;
    throw err;
  }
}

describe("sniffImageType", () => {
  it("names each accepted type from its magic bytes", () => {
    expect(sniffImageType(png())).toBe("image/png");
    expect(sniffImageType(jpeg())).toBe("image/jpeg");
    expect(sniffImageType(webp([webpVp8Chunk(4, 4)]))).toBe("image/webp");
  });

  it("returns null for every non-image document", () => {
    for (const bytes of [HTML_DOCUMENT, SVG_DOCUMENT, PDF_DOCUMENT, GIF_IMAGE, ELF_BINARY]) {
      expect(sniffImageType(bytes)).toBeNull();
    }
  });

  it("withholds a verdict only while the prefix is still consistent with a signature", () => {
    // Streaming: a 3-byte first chunk of a PNG is not yet a rejection…
    expect(sniffImageType(png().subarray(0, 3))).toBeUndefined();
    // …but a 3-byte chunk that has already diverged from all three is.
    expect(sniffImageType(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });
});

describe("the guard refuses anything that is not one of the three types", () => {
  it.each([
    ["an HTML document", HTML_DOCUMENT],
    ["an SVG document", SVG_DOCUMENT],
    ["a PDF", PDF_DOCUMENT],
    ["a GIF", GIF_IMAGE],
    ["an ELF binary", ELF_BINARY],
    ["an empty body", Buffer.alloc(0)],
  ])("rejects %s as UNSUPPORTED_IMAGE_TYPE", (_label, bytes) => {
    expect(reject(bytes)).toBe("UNSUPPORTED_IMAGE_TYPE");
  });

  it("does not believe the declared content type — the verdict is the bytes", () => {
    // This is 046 E6 in one assertion: the caller says `image/png`, and the
    // guard has no parameter through which to hear it.
    expect(reject(HTML_DOCUMENT)).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect(sanitizeImage(png()).verdict.type).toBe("image/png");
  });
});

describe("PNG", () => {
  it("passes an honest PNG through byte-perfect and reports its dimensions", () => {
    const file = png({ width: 7, height: 5 });
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict).toMatchObject({ type: "image/png", extension: ".png", width: 7, height: 5 });
    expect(verdict.strippedMetadata).toBe(false);
    expect(bytes.equals(file)).toBe(true);
    // And the image survives as an image: the IDAT still inflates.
    expect(() => inflateSync(pngIdat(bytes))).not.toThrow();
  });

  it("drops tEXt, zTXt, iTXt, eXIf and tIME, and keeps the rendering chunks", () => {
    const file = png({
      chunks: [
        pngTextChunk("Comment", HTML_DOCUMENT.toString("latin1")),
        pngChunk("zTXt", Buffer.from("Software\x00\x00compressed", "latin1")),
        pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\x00", "latin1")),
        pngExifChunk(),
        pngChunk("tIME", Buffer.alloc(7)),
        pngChunk("sRGB", Buffer.from([0])),
      ],
    });
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict.strippedMetadata).toBe(true);
    expect(pngChunkTypes(bytes)).toEqual(["IHDR", "sRGB", "IDAT", "IEND"]);
    // The smuggled document is not on disk in any form.
    expect(bytes.includes(Buffer.from("<script>", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("GPSPAYLOAD", "latin1"))).toBe(false);
    expect(verdict.bytesOut).toBe(bytes.length);
    expect(verdict.bytesIn).toBe(file.length);
  });

  it("drops iCCP, sPLT and hIST — unbounded blobs with no checkable magic", () => {
    // Item 2's PNG half: the JPEG answer was keep-and-check because an APP2
    // identifies itself; a PNG colour profile does not, so it is dropped.
    const file = png({
      chunks: [
        pngChunk("iCCP", Buffer.concat([Buffer.from("profile\0\0", "latin1"), HTML_DOCUMENT])),
        pngChunk("sPLT", Buffer.from("pal\0\x08", "latin1")),
        pngChunk("hIST", Buffer.alloc(8)),
      ],
    });
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict.strippedMetadata).toBe(true);
    expect(pngChunkTypes(bytes)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(bytes.includes(Buffer.from("<script>", "latin1"))).toBe(false);
  });

  it("refuses a forged signature for the RIGHT reason: the first chunk is not IHDR", () => {
    // Item 6. An HTML document behind a PNG signature produces both a nonsense
    // chunk length and a non-IHDR first chunk; the second is the true finding.
    const forged = Buffer.concat([png().subarray(0, 8), HTML_DOCUMENT]);
    let reason = "";
    try {
      sanitizeImage(forged);
    } catch (err) {
      reason = (err as MediaRejected).reason;
    }
    expect(reason).toContain("first chunk");
    expect(reason).not.toContain("declares");
  });

  it("rejects a chunk type that is not on the allowlist", () => {
    // An APNG control chunk: a real chunk type, and not one this system reads.
    expect(reject(png({ chunks: [pngChunk("acTL", Buffer.alloc(8))] }))).toBe("MALFORMED_IMAGE");
    // A private chunk carrying a payload nobody classified.
    expect(reject(png({ chunks: [pngChunk("hAxX", HTML_DOCUMENT)] }))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a polyglot: bytes appended after IEND", () => {
    expect(reject(png({ trailer: HTML_DOCUMENT }))).toBe("MALFORMED_IMAGE");
    expect(reject(png({ trailer: PDF_DOCUMENT }))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a signature with no image behind it", () => {
    const file = png();
    expect(reject(file.subarray(0, 20))).toBe("MALFORMED_IMAGE"); // truncated
    expect(reject(file.subarray(0, 8))).toBe("MALFORMED_IMAGE"); // signature alone
  });

  it("rejects a decompression bomb from the IHDR, without decoding it", () => {
    // 64,000 × 64,000 = 4.1 Gpx, ≈16 GB decoded, in a file of a few hundred bytes.
    const bomb = png({ width: 2, height: 2, declaredWidth: 64_000, declaredHeight: 64_000 });
    expect(bomb.length).toBeLessThan(1024);
    expect(reject(bomb)).toBe("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("rejects a strip that is under the pixel ceiling but over the dimension ceiling", () => {
    // 1 × 400,000 is 400 kpx — comfortably under `maxPixels` — and is exactly
    // the shape an area-only guard accepts.
    const strip = png({ declaredWidth: 1, declaredHeight: 400_000 });
    expect(1 * 400_000).toBeLessThan(DEFAULT_MEDIA_LIMITS.maxPixels);
    expect(reject(strip)).toBe("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("accepts the largest frame the pilot's cameras can produce", () => {
    // 035 §9's mid-tier Android is a 50 MP sensor; 8160 × 6120 is that frame.
    expect(sanitizeImage(png({ declaredWidth: 8160, declaredHeight: 6120 })).verdict.width).toBe(8160);
  });

  it("rejects a zero dimension", () => {
    expect(reject(png({ declaredWidth: 0, declaredHeight: 4 }))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a file whose first chunk is not IHDR", () => {
    const file = png();
    const forged = Buffer.concat([file.subarray(0, 8), pngChunk("sRGB", Buffer.from([0])), file.subarray(8)]);
    expect(reject(forged)).toBe("MALFORMED_IMAGE");
  });

  it("rejects a PNG with no image data at all", () => {
    const signature = png().subarray(0, 8);
    const ihdr = png().subarray(8, 8 + 25);
    const iend = pngChunk("IEND", Buffer.alloc(0));
    expect(reject(Buffer.concat([signature, ihdr, iend]))).toBe("MALFORMED_IMAGE");
  });
});

describe("JPEG", () => {
  it("passes an honest JPEG through and reports its dimensions", () => {
    const file = jpeg({ width: 4032, height: 3024 });
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict).toMatchObject({ type: "image/jpeg", extension: ".jpg", width: 4032, height: 3024 });
    expect(bytes.equals(file)).toBe(true);
  });

  it("drops APP1 (EXIF and XMP), APP13 (Photoshop IRB) and COM; keeps APP0", () => {
    const file = jpeg({
      segments: [
        jpegExifSegment(),
        jpegPhotoshopSegment(),
        jpegCommentSegment(HTML_DOCUMENT.toString("latin1")),
      ],
    });
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict.strippedMetadata).toBe(true);
    // APP0 (0xe0) survives; APP1 (0xe1), APP13 (0xed) and COM (0xfe) do not.
    const markers = jpegMarkers(bytes);
    expect(markers).toContain(0xe0);
    expect(markers).not.toContain(0xe1);
    expect(markers).not.toContain(0xed);
    expect(markers).not.toContain(0xfe);
    // The GPS coordinates are not on disk (022 P7, 046 §5 A3).
    expect(bytes.includes(Buffer.from("GPSLatitude", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("<script>", "latin1"))).toBe(false);
  });

  it("walks the entropy-coded scan without mistaking stuffing or a restart marker for EOI", () => {
    // The fixture's scan carries `FF 00` and `FF D0` on purpose.
    const { bytes } = sanitizeImage(jpeg());
    expect(bytes.subarray(bytes.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it("rejects a polyglot: bytes appended after EOI", () => {
    expect(reject(jpeg({ trailer: HTML_DOCUMENT }))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a truncated JPEG with no EOI", () => {
    expect(reject(jpeg({ omitEoi: true }))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a marker that is not on the allowlist", () => {
    const file = jpeg();
    // 0xF7 is JPEG-LS SOF55: a real marker, and not one this pipeline accepts.
    const forged = Buffer.concat([
      file.subarray(0, 2),
      Buffer.from([0xff, 0xf7, 0x00, 0x04, 0x00, 0x00]),
      file.subarray(2),
    ]);
    expect(reject(forged)).toBe("MALFORMED_IMAGE");
  });

  it("rejects an oversize frame declared in the SOF header", () => {
    expect(reject(jpeg({ width: 30_000, height: 30_000 }))).toBe("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  // THE SECOND-FRAME-HEADER BOMB (invariant review of 1c25749, item 1). The
  // dimensions used to be read from the FIRST SOF and every later one copied
  // through unchecked, so all three of these were stored as 8x8 images with a
  // multi-gigapixel frame header inside them — and the next decoder to open the
  // file reads the header it was handed, not the one this guard measured.
  it.each([
    [
      "a huge SOF2 after a tiny SOF0",
      jpeg({ width: 8, height: 8, afterFrame: [jpegFrameSegment(64_000, 64_000)] }),
    ],
    [
      "a huge SOF0 after the scan",
      jpeg({ width: 8, height: 8, afterScan: [jpegFrameSegment(64_000, 64_000, 0xc0)] }),
    ],
    [
      "a huge SOF15 after a tiny SOF0",
      jpeg({ width: 8, height: 8, afterFrame: [jpegFrameSegment(30_000, 30_000, 0xcf)] }),
    ],
  ])("rejects %s", (_label, file) => {
    expect(reject(file)).toBe("MALFORMED_IMAGE");
  });

  it("still accepts a progressive JPEG, which has ONE frame header and many scans", () => {
    const progressive = jpeg({ width: 1600, height: 2400, frameMarker: 0xc2 });
    expect(sanitizeImage(progressive).verdict).toMatchObject({ width: 1600, height: 2400 });
  });

  it("keeps an APP2 that proves it is an ICC profile", () => {
    const { verdict, bytes } = sanitizeImage(jpeg({ segments: [jpegIccSegment()] }));
    expect(jpegMarkers(bytes)).toContain(0xe2);
    expect(verdict.strippedMetadata).toBe(false);
  });

  it("rejects an APP2 that is not an ICC profile — a kept blob has to say what it is", () => {
    expect(reject(jpeg({ segments: [jpegFakeIccSegment(HTML_DOCUMENT)] }))).toBe("MALFORMED_IMAGE");
    expect(reject(jpeg({ segments: [jpegFakeIccSegment(Buffer.from("ICC", "latin1"))] }))).toBe(
      "MALFORMED_IMAGE"
    );
  });
});

describe("WebP", () => {
  it("passes an honest lossy WebP through and reports its dimensions", () => {
    const file = webp([webpVp8Chunk(1200, 900)]);
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict).toMatchObject({ type: "image/webp", extension: ".webp", width: 1200, height: 900 });
    expect(bytes.equals(file)).toBe(true);
  });

  it("drops EXIF and XMP chunks, clears the VP8X flags that promised them, and fixes the RIFF length", () => {
    const flags = 0x08 | 0x04; // EXIF | XMP: the file says it carries both
    const file = webp([
      webpVp8xChunk(600, 400, flags),
      webpExifChunk(),
      webpVp8Chunk(600, 400),
      webpXmpChunk(),
    ]);
    const { verdict, bytes } = sanitizeImage(file);
    expect(verdict.strippedMetadata).toBe(true);
    expect(webpChunkFourccs(bytes)).toEqual(["VP8X", "VP8 "]);
    expect(bytes[20]! & flags).toBe(0);
    // The container's own length field agrees with the file that remains — a
    // stale length is how a stripped WebP becomes an unreadable one.
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.includes(Buffer.from("GPSPAYLOAD", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("xmpmeta", "latin1"))).toBe(false);
  });

  it("rejects an animated WebP", () => {
    const file = webp([webpVp8xChunk(60, 40, 0x02), webpAnimChunk(), webpVp8Chunk(60, 40)]);
    expect(reject(file)).toBe("MALFORMED_IMAGE");
  });

  it("rejects a chunk that is not on the allowlist", () => {
    expect(reject(webp([webpVp8Chunk(60, 40), webpAnimChunk()]))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a polyglot: bytes after the RIFF payload", () => {
    expect(reject(webp([webpVp8Chunk(60, 40)], HTML_DOCUMENT))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a container with no bitstream chunk", () => {
    expect(reject(webp([webpVp8xChunk(60, 40, 0)]))).toBe("MALFORMED_IMAGE");
  });

  it("rejects a chunk that overruns the declared RIFF size", () => {
    const file = webp([webpVp8Chunk(60, 40)]);
    file.writeUInt32LE(10, 4);
    expect(reject(file)).toBe("MALFORMED_IMAGE");
  });

  it("keeps an ICCP chunk that carries a real profile and rejects one that does not", () => {
    const honest = webp([webpIccpChunk(true), webpVp8Chunk(60, 40)]);
    expect(webpChunkFourccs(sanitizeImage(honest).bytes)).toEqual(["ICCP", "VP8 "]);
    expect(reject(webp([webpIccpChunk(false), webpVp8Chunk(60, 40)]))).toBe("MALFORMED_IMAGE");
    expect(reject(webp([webpIccpChunk(true, HTML_DOCUMENT), webpVp8Chunk(60, 40)]))).toBe("MALFORMED_IMAGE");
  });

  it("rejects an oversize canvas declared in VP8X", () => {
    expect(reject(webp([webpVp8xChunk(30_000, 30_000, 0), webpVp8Chunk(60, 40)]))).toBe(
      "IMAGE_DIMENSIONS_TOO_LARGE"
    );
  });
});

describe("the streaming path answers exactly as the whole-buffer path does", () => {
  const cases: Array<[string, Buffer]> = [
    [
      "png with metadata",
      png({ chunks: [pngTextChunk("Comment", "hello"), pngExifChunk()], padPixels: 4096 }),
    ],
    ["jpeg with metadata", jpeg({ segments: [jpegExifSegment()], scanPadding: 4096 })],
    ["webp with metadata", webp([webpVp8xChunk(60, 40, 0x0c), webpExifChunk(), webpVp8Chunk(60, 40, 4096)])],
  ];

  it.each(cases)("chunked one byte at a time: %s", (_label, file) => {
    const oneShot = sanitizeImage(file);
    const sanitizer = new ImageSanitizer(DEFAULT_MEDIA_LIMITS);
    const parts: Buffer[] = [];
    for (let i = 0; i < file.length; i += 1) parts.push(sanitizer.update(file.subarray(i, i + 1)));
    const verdict = sanitizer.finish();
    const bytes = Buffer.concat(parts);
    if (verdict.riffSizePatch !== undefined) bytes.writeUInt32LE(verdict.riffSizePatch, 4);
    expect(bytes.equals(oneShot.bytes)).toBe(true);
    expect(verdict).toEqual(oneShot.verdict);
  });

  it.each(cases)("chunked on awkward boundaries: %s", (_label, file) => {
    const oneShot = sanitizeImage(file);
    const sanitizer = new ImageSanitizer(DEFAULT_MEDIA_LIMITS);
    const parts: Buffer[] = [];
    for (let i = 0; i < file.length; i += 7) parts.push(sanitizer.update(file.subarray(i, i + 7)));
    const verdict = sanitizer.finish();
    const bytes = Buffer.concat(parts);
    if (verdict.riffSizePatch !== undefined) bytes.writeUInt32LE(verdict.riffSizePatch, 4);
    expect(bytes.equals(oneShot.bytes)).toBe(true);
  });
});

describe("quotaBreach", () => {
  const clear = { sessionPhotos: 0, sessionBytes: 0, shopPhotos: 0, shopBytes: 0 };

  it("passes a session that is holding nothing", () => {
    expect(quotaBreach(clear, DEFAULT_MEDIA_QUOTA)).toBeUndefined();
  });

  it("names the scope and the kind of every ceiling", () => {
    expect(
      quotaBreach({ ...clear, sessionPhotos: DEFAULT_MEDIA_QUOTA.sessionPhotoLimit }, DEFAULT_MEDIA_QUOTA)
    ).toEqual({ scope: "session", limit_kind: "count" });
    expect(
      quotaBreach({ ...clear, sessionBytes: DEFAULT_MEDIA_QUOTA.sessionByteLimit }, DEFAULT_MEDIA_QUOTA)
    ).toEqual({
      scope: "session",
      limit_kind: "bytes",
    });
    expect(
      quotaBreach({ ...clear, shopPhotos: DEFAULT_MEDIA_QUOTA.shopPhotoLimit }, DEFAULT_MEDIA_QUOTA)
    ).toEqual({
      scope: "shop",
      limit_kind: "count",
    });
    expect(
      quotaBreach({ ...clear, shopBytes: DEFAULT_MEDIA_QUOTA.shopByteLimit }, DEFAULT_MEDIA_QUOTA)
    ).toEqual({
      scope: "shop",
      limit_kind: "bytes",
    });
  });

  it("is a floor, not a fence: one under the ceiling is allowed", () => {
    expect(
      quotaBreach({ ...clear, sessionPhotos: DEFAULT_MEDIA_QUOTA.sessionPhotoLimit - 1 }, DEFAULT_MEDIA_QUOTA)
    ).toBeUndefined();
  });
});
