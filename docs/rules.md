# TrueBatch API rules

The 25 TrueBatch API rules (minimum register, 18 Nov 2026): 13 carried over from TrueBatch Tablets unchanged, 8
changed, 4 new (TA-24 to TA-27); TA-15 and TA-16 (compression, punches and coating) are not used. Each rule is checked
once, in the app. Each test that proves a rule starts its name with the rule ID, e.g. `TA-08 the person who performed
a step cannot check it`. `npm run traceability` prints the rule-to-test list; CI (`npm run traceability -- --check`)
fails when a rule has no test, unless its feature comes later (marked "later" in the Tests column).

Clauses: XII = Revised Schedule M Part XII (APIs), with the same paragraph of ICH Q7 / EudraLex Vol 4 Part II in
brackets; SCHM = Revised Schedule M Part I; A11 = EU Annex 11; CFR11 = 21 CFR Part 11. 21 CFR 211 does not apply to
API manufacture. QA should confirm the clauses against the official texts before validation.

| Rule | Requirement | Clauses | Tests |
|------|-------------|---------|-------|
| TA-01 | A master is complete before approval: materials by code, quantities per batch or in molar equivalents, equipment, step order, parameter ranges, IPCs with limits, time limits, expected yield per stage, storage, packaging, label and retest period | XII 6.4.2(i)-(vii) (Q7 6.41); 6.1.8 (Q7 6.17); SCHM 17.3.6 | `test/master-checks.test.ts` |
| TA-02 | A master is checked by a second person and approved by QA; one effective version; a new version needs a change control number | XII 6.4.1 (Q7 6.40); 2.2.3(v) (Q7 2.22); 6.1.2 (Q7 6.11); 13.3, 13.6 (Q7 13.12, 13.15) | `test/master-review.test.ts`, `test/links.test.ts` (QMS change control) |
| TA-03 | A batch is issued from the effective master, with a unique number never reused (prefix TA) | XII 6.5.1, 6.5.2 (Q7 6.50, 6.51) | `test/batches.test.ts` |
| TA-04 | Entries are saved at once, with the person and the server time; late entries need a reason | XII 6.1.5 (Q7 6.14); 2.1.6 (Q7 2.16); 5.4.4 (Q7 5.43) | `test/batches.test.ts`, `test/release.test.ts` |
| TA-05 | TrueBatch keeps its own audit trail | XII 5.4.4 (Q7 5.43); A11 9; CFR11 11.10(e) | `test/batches.test.ts` |
| TA-06 | A correction keeps the original value and its reason, and reaches the steps that used it; nothing is deleted | XII 6.1.5, 6.1.4 (Q7 6.14, 6.13) | `test/engine.test.ts`, `test/batches.test.ts` |
| TA-07 | E-signatures carry the name, time and meaning, linked to what was signed | XII 6.1.9 (Q7 6.18); 6.5.3(vi) (Q7 6.52); CFR11 11.50, 11.70; A11 14 | `test/batches.test.ts` |
| TA-08 | Significant steps have a second-person check (each dispensing, charge, liquid charge, yield and hand-typed critical value); the checker is not the performer | XII 8.1.3, 8.1.4 (Q7 8.12, 8.13); 5.4.6 (Q7 5.45); 6.5.3(vi) | `test/engine.test.ts`, `test/batches.test.ts`, `test/master-checks.test.ts`, `test/mywork.test.ts` |
| TA-09 | Steps are done in order; a departure needs a deviation note (an IPC round "not complete, continue" is not a departure) | XII 2.1.7, 8.1.6 (Q7 2.17, 8.15); 6.5.3(xi) | `test/engine.test.ts` |
| TA-10 | Before each stage the room and equipment are clear and clean; non-dedicated equipment last used for another product needs a verified product-changeover cleaning (Logbook) | XII 5.2.2(vii), 5.2.5, 5.2.7 (Q7 5.21, 5.24, 5.26); 8.1.7 (Q7 8.16); 8.5.2 (Q7 8.51) | `test/master-checks.test.ts`, `test/engine.test.ts`, `test/designer.test.ts`, `test/links.test.ts` (cleaning facts from the Logbook; typed from the label without it) |
| TA-11 | Equipment and rooms are fit for use (Logbook); calibration not overdue | XII 5.3.4, 5.3.5 (Q7 5.33, 5.34); 6.5.3(ii) (Q7 6.52) | `test/batches.test.ts` (master data), `test/picks.test.ts` (the machines offered: balances of the master's dispensing rooms, lines in the stage's rooms), `test/master-checks.test.ts` (a stage names its rooms), `test/links.test.ts` (Logbook status; the label questions without it) |
| TA-12 | Only released, in-date lots of the master's material are used (intermediates and recovered solvents too) | XII 2.1.8 (Q7 2.18); 7.2.1 (Q7 7.20); 6.5.3(iii) | `test/links.test.ts` (MMS lot status, material and dates; the label without it), `test/lims.test.ts` (QC report of a lot typed by hand) |
| TA-13 | Dispensing and charging: the target comes from the master (per batch, or by equivalents of the actual key input), adjusted for assay; liquids by volume or weight; each container identified and verified | XII 8.1.1-8.1.3 (Q7 8.10-8.12); 6.4.2(iii); 6.5.3(iii) | `test/engine.test.ts`, `test/master-checks.test.ts` |
| TA-14 | Process parameters and IPCs against the master's limits; every result kept; a step processed to a target repeats until in limit; a final result outside limits needs a deviation note | XII 8.3.1-8.3.4, 8.3.7 (Q7 8.30-8.33, 8.36); 6.5.3(iv),(v),(vii); 8.2.1 (Q7 8.20); 14.2.2 (Q7 14.21) | `test/engine.test.ts`, `e2e/floor.spec.ts`, `test/lims-in-process.test.ts` (QC lab IPC results picked from LIMS) |
| TA-17 | Time limits and hold times run on the server clock (reaction, hold of a solution or wet cake, intermediates between stages); an overrun needs a deviation note | XII 8.2.1, 8.2.2 (Q7 8.20, 8.21); 6.4.2(v)(d) | `test/engine.test.ts`, `test/batches.test.ts` |
| TA-18 | Yield of each intermediate and the API is calculated (molar or stated theoretical) and compared with the expected range; out of range blocks release until a deviation is linked | XII 8.1.5 (Q7 8.14); 6.4.2(v)(e); 6.5.3(viii) | `test/engine.test.ts`, `test/release.test.ts` |
| TA-19 | Reprocessing and rework only as a new batch from a QA-approved master linked to the source; recovered material only where the master names it, as a released lot | XII 14.1, 14.2.1, 14.2.3, 14.3.1-14.3.3, 14.4.1 (Q7 14.10, 14.20, 14.22, 14.30-14.32, 14.40); 8.1.8 (Q7 8.17) | `test/batches.test.ts` |
| TA-20 | The record is complete before production signs | XII 2.3(iii) (Q7 2.30) | `test/release.test.ts`, `test/batches.test.ts` |
| TA-21 | QC approval, then QA review and release or rejection by e-signature; all changes and deviations shown; release blocked until linked deviations are closed and every note without a number is closed here or sent to Deviations (owner, 20 Nov 2026); only a released API or intermediate goes to stores | XII 2.2.3(i),(iii),(iv) (Q7 2.22); 6.7.1-6.7.3 (Q7 6.70-6.72); 6.5.3(xii); 10.2.1 (Q7 10.20); 2.1.5 (Q7 2.15) | `test/release.test.ts`, `test/batches.test.ts`, `test/links.test.ts` (Deviations status; a note without a number closed here or sent), `e2e/release.spec.ts` (Close here), `test/packing.test.ts` and `test/packing-api.test.ts` (packing: QC before QA), `test/lims.test.ts` (QC approval's CoA from LIMS) |
| TA-22 | A complete copy (PDF) with its signatures and changes | XII 6.1.6, 6.1.7 (Q7 6.15, 6.16) | `test/batches.test.ts`, `e2e/release.spec.ts` |
| TA-23 | A step that names a training is signed (performed or checked) only by a person Recruitment shows trained in it | XII 3.1.1, 3.1.3 (Q7 3.10, 3.12) | `test/training.test.ts`, `e2e/floor.spec.ts` |
| TA-24 | Recovered solvents are traced: sent to recovery with quantity and containers (a recovered-solvent lot for MMS); charged only where the master allows, as a released lot | XII 14.4.2-14.4.4 (Q7 14.41-14.43); 7.2.2 (Q7 7.21) | `test/links.test.ts` (lot of the recovered material; output_lot_v1) |
| TA-25 | Blending of batches: only released batches, every source batch and quantity listed; retest date from the oldest batch; combining loads of one batch is not blending | XII 8.4.1, 8.4.2, 8.4.5, 8.4.8 (Q7 8.40, 8.41, 8.44, 8.47) | `test/links.test.ts` (output_lot_v1: retest from the oldest API lot) |
| TA-26 | Pack and label: packing room clear; containers issued from released lots; each container filled, weighed, sealed and its label checked; labels reconciled and batch-coded leftovers destroyed | XII 9.2.2, 9.3.2, 9.3.3, 9.3.6, 9.3.7, 9.4.3-9.4.7 (Q7 9.21, 9.31, 9.32, 9.35, 9.36, 9.42-9.46); 6.5.3(ix),(x) | `test/master-checks.test.ts`, `test/blocks.test.ts` |
| TA-27 | The retest date is worked out from the date of manufacture and the master's retest period, never typed | XII 11.5.2 (Q7 11.61); 9.4.4 (Q7 9.43); 8.4.8 (Q7 8.47) | `test/batches.test.ts`, `test/links.test.ts` (output_lot_v1) |

## Notes: safety rules built into the calculation templates

These notes record which TrueBatch rule each template safety rule protects. They are not rule rows, and they add no
rules to the table above. Each safety rule refuses with a plain-English message. Each has its own tests in
`test/templates/` (the test names start with the template ID). The templates are described in
`shared/templates/README.md`.

- **TA-13 (dispensing):**
  - **Same basis (C5, built into T9).** A hydrate or solvate molecular weight in the salt factor (T11) together with
    a water, LOD or solvent correction of the assay (T9) is refused, because it counts the water twice (about 6.7 %
    too much pantoprazole).
    A salt, ester, hydrate or compound factor is also refused when the certificate states the potency "as parent"
    (µg of parent drug per mg of material) or "as element" (% Ca, % Zn, % Fe), because that factor is already
    inside the potency.
  - **Molecules per salt formula unit (T11).** The salt factor uses the MW of the salt divided by the number of drug
    molecules per formula unit (2 for hemifumarates and for calcium salts with two anions), so a hemi-salt cannot
    double the dose. A hemi-salt left at 1 molecule per unit with the MW of the whole formula unit (at least twice
    the other form's) is refused.
  - **No negative filler (T10).** A compensating excipient that would go below zero is refused: the batch weight
    cannot be kept, and a deviation is needed.
  - **Potency units are never a mass.** IU, CFU and activity units never convert to a mass. They become a weight
    only through the lot's content per gram (T18).
- **TA-14 (in-process checks against the master's limits):**
  - **No weight-variation method for coated tablets other than film-coated (T14).** Uniformity of dosage units by
    weight variation is refused for sugar-coated and other coated tablets. It is also refused below 25 mg or 25 %
    of the unit, and for products set to "individual results only".
- **TA-16 (coating solutions):**
  - **No negative water or solvent (T17).** A liquid make-up whose water or solvent to add would be negative (the
    target solids are higher than the ingredients allow) is refused.
