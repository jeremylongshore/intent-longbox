// The causal reference AS CHECKED — a type with no imports, and that is the
// whole reason it is its own file (E02-D11; 040 A1, 041 §3.5, 042 §6).
//
// WHAT IT IS. `Against` (the wire shape in `src/contracts/v1/schemas.ts`) is what
// a CLIENT claims it was looking at. A `WitnessedReference` is what
// `assertWorldViewIsCurrent` PROVED, inside the writing transaction and under the
// anchor lock, actually named a live row of that table in that shop and that
// session. The two are structurally identical, so without a brand
// `insertHumanConfirmation(…, body.against)` would type-check and store an
// unverified claim about what a person was shown — in a column that exists to
// answer exactly that question, in a row that can never be edited.
//
// The brand is erased at runtime: it costs nothing, and it cannot be produced
// outside `worldView.ts`, which is the only module that can honestly produce one.
//
// WHY A SEPARATE FILE. `src/contracts/v1/schemas.ts` imports `GRADE_LABELS` from
// `src/services/condition.ts`, so ANY import from the contract layer into
// `condition.ts` closes a cycle and `pnpm depcruise`'s `no-circular` rule fails —
// correctly, since 029 §3.1 makes the module graph a DAG. A leaf with no imports
// is what lets the three writing services share one type without either module
// reaching for the other. (The alternative, moving `GRADE_LABELS` into the
// contract layer, is a real change to who owns the grade vocabulary and belongs
// to a bead that is about that.)
//
// WHY `table` IS `string` HERE. Widening it is deliberate: the narrow set is
// enforced where narrowness is a property anyone can violate — by Zod at the
// edge, where a client's value arrives (`AGAINST_TABLES`), and by migration
// `030`'s CHECK in the database, where a row is finally written. Restating the
// union in a third place would be a third list to keep in step, and this type's
// job is to carry the PROVENANCE, not the vocabulary.

declare const witnessed: unique symbol;

/**
 * A `{ table, id }` reference that the causal check accepted. The only value a
 * writer may put into `against_table` / `against_id` (migration `030`).
 */
export type WitnessedReference = {
  readonly table: string;
  readonly id: string;
  readonly [witnessed]: true;
};
