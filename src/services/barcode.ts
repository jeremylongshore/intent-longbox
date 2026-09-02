// UPC-A + 5-digit supplement parse (deterministic, pure — R4).
// Input is the decoded digit string from the client's scanner, not camera frames.
//
// Post-1990 comic UPCs: 12-digit UPC-A identifies the series; the 5-digit
// supplement encodes issue (digits 1-3), cover variant (digit 4), printing (digit 5).

export interface BarcodeParse {
  ok: true;
  upc: string; // 12-digit UPC-A, check digit verified
  supplement?: {
    raw: string;
    issue: number; // digits 1-3
    cover: number; // digit 4
    printing: number; // digit 5
  };
}

export interface BarcodeParseError {
  ok: false;
  error: string;
}

export type BarcodeResult = BarcodeParse | BarcodeParseError;

export function upcCheckDigitValid(upc: string): boolean {
  if (!/^\d{12}$/.test(upc)) return false;
  let odd = 0;
  let even = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(upc[i]);
    if (i % 2 === 0) odd += d;
    else even += d;
  }
  const check = (10 - ((odd * 3 + even) % 10)) % 10;
  return check === Number(upc[11]);
}

/**
 * Parse a decoded barcode digit string: "UPCA" (12), "UPCA SUPPLEMENT" or
 * "UPCASUPPLEMENT" (17). Whitespace/hyphens tolerated.
 */
export function parseComicBarcode(input: string): BarcodeResult {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: "barcode input contains non-digit characters" };
  }
  if (digits.length !== 12 && digits.length !== 17) {
    return {
      ok: false,
      error: `expected 12 (UPC-A) or 17 (UPC-A + 5-digit supplement) digits, got ${digits.length}`,
    };
  }
  const upc = digits.slice(0, 12);
  if (!upcCheckDigitValid(upc)) {
    return { ok: false, error: "UPC-A check digit invalid" };
  }
  if (digits.length === 12) {
    return { ok: true, upc };
  }
  const supp = digits.slice(12);
  return {
    ok: true,
    upc,
    supplement: {
      raw: supp,
      issue: Number(supp.slice(0, 3)),
      cover: Number(supp[3]),
      printing: Number(supp[4]),
    },
  };
}
