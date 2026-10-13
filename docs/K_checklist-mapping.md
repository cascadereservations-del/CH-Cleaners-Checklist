# Lane K: checklist old-to-new mapping (session 82)

Principles: Gawande-style short lists at natural pause points. DO-CONFIRM lines for routine work (one line per zone, the sub-points sit in a
"What this covers" expander). READ-DO lines for rare or easily forgotten steps. KILLER items (a guest complaint, damage or a safety problem)
are confirm-or-report-an-issue items that GATE the phase, using the same Confirmed / Issue Found control that Confirm & Leave already has.

Compatibility: every surviving id is kept. A merged line has ONE surviving id plus `covers: [old ids]`. A restored `ch_draft_v6` draft that has no
`_k` marker is migrated: a merged line is ticked only if its own id AND all its `covers` were ticked; a killer that was an ordinary tick and was
ticked becomes `confirmed` (the SmartLife precedent, v8.7); `phase` is mapped 0,1,2,3,4 -> 0,1,2,3,5 (old Clean was one screen, now two; old
Finish is 5). `checklistDetails` keeps its shape (sections of title, icon, items {text, checked, critical}); killers ride in the existing
"Confirm & Leave" section with `critical: true`, so the e-mail "Critical Items Summary" still lists them.

Phases (7, was 5): 0 Setup, 1 Document, 2 Arrive & Prep, 3 Bedroom & Living (split from Clean), 4 Bathroom & Kitchen (split from Clean),
5 Finish (floors, walkthrough, vacuum, weekly tasks, after-clean photos), 6 Lock up (Power & Safety card, Confirm & Leave set, Submit).
Screens were split because the Finish list alone was 10 lines. `ch_phase` / draft `phase`: old 0,1,2,3 -> same, old 4 (Finish) -> 5.
Wording in the table below is the intent; the shipped lines are the shortened forms in index.html (verb first, 50 to 70 characters, the detail
behind a "How to do it" or "What this covers" expander so a screen stays near one and a half screens at 360x800).

## Old id -> new line (all 37 ordinary ticks)

| Old id | Old text (short) | New line (surviving id) | How | New phase |
|---|---|---|---|---|
| check_0_1 | Gather tools and supplies | check_0_1 "Gather your tools and supplies, open the windows and turn on every light" | kept, absorbs check_1_1 | 2 |
| check_1_1 | Open windows, lights on | check_0_1 | merged (covers) | 2 |
| check_1_4 | Test appliances | check_1_4 "Check each appliance works ... air purifier (filter light green)" | kept, absorbs check_1_11; flag | 2 |
| check_1_11 | Air purifier on, filter green | check_1_4 | merged (covers) | 2 |
| check_1_5 | Inspect damage, leaks, wear | check_1_5 "Look over walls, ceiling, floor and furniture ... collect anything a guest left behind" | kept, absorbs check_1_7; flag | 2 |
| check_1_7 | Sweep for left-behind items | check_1_5 | merged (covers) | 2 |
| check_1_9 | Key card on keychain | check_1_9 "Find the key card on the keychain inside the unit; report it now if it is missing" | kept alone (READ-DO, rare), flag | 2 |
| check_2_4 | Strip bed and towels, inspect stains | check_2_4 | kept, KILLER (gated, confirm or issue), critical; per type: turnover, deep_clean, mid_stay | 2 |
| check_2_1 | Remove trash and food | check_2_1 "Clear all trash and food from every room; empty the washing machine drum and leave its door open" | kept, absorbs check_1_10 | 2 |
| check_1_10 | Reset washing machine | check_2_1 | merged (covers) | 2 |
| check_3_1 | Pre-spray toilet and shower | check_3_1 "Spray the toilet, shower, stove and microwave and leave them to soak. Do not scrub yet." | kept (READ-DO), absorbs check_3_4 | 2 |
| check_3_4 | Pre-spray stove and microwave | check_3_1 | merged (covers) | 2 |
| check_4_1 | Dust everything | check_4_1 "Reset the bedroom and living room: dusted top to bottom, switches and handles disinfected, decor straight, mirrors streak-free" | kept (DO-CONFIRM), absorbs check_4_5, check_5_8; disinfect; photo standard | 3 |
| check_4_5 | Disinfect high-touch surfaces | check_4_1 | merged (covers) | 3 |
| check_5_8 | Arrange items, polish mirrors | check_4_1 | merged (covers) | 3 |
| check_5_2 | Make the bed hotel standard | check_5_2 "Make the bed to hotel standard: sheets tight, no wrinkles, pillows plumped in a straight row" | kept (DO-CONFIRM), absorbs check_5_6; "See the standard" bed | 3 |
| check_5_6 | Fluff and arrange pillows | check_5_2 | merged (covers) | 3 |
| check_5_9 | Count hangers, minimum 8 | check_5_9 "Count the wardrobe hangers: there must be 8 ..." | kept alone (READ-DO), flag | 3 |
| check_5_10 | Reset cloth steamer | check_5_10 "Reset the cloth steamer ... and top up the room fragrance if it is low" | kept (READ-DO), absorbs check_5_7 | 3 |
| check_5_7 | Refill room fragrance | check_5_10 | merged (covers) | 3 |
| check_1_8 | Water plants only if dry | check_1_8 "Water the plants only if the soil is dry 2 cm down ..." | kept (READ-DO), absorbs check_snake_room; moved from Arrive to the bedroom and living room where the plants are | 3 |
| check_snake_room | Snake plants inside if 2+ nights | check_1_8 | merged (covers) | 3 |
| check_7_4 | Scrub toilet, shower, sink | check_7_4 "Scrub the toilet, shower and sink now the chemicals have soaked; mirror and glass streak-free" | kept (DO-CONFIRM), absorbs check_7_2; disinfect; "See the standard" bathroom | 4 |
| check_7_2 | Polish mirrors and glass | check_7_4 | merged (covers) | 4 |
| check_drain_screen | Install drain screen | check_drain_screen "Fit the drain screen over the shower drain (stays of 2+ nights)" | kept alone (READ-DO), flag | 4 |
| check_7_5 | Smell-check toilet, clean vent | check_7_5 "Flush several times and smell-check the toilet; wipe the vent grille" | kept, KILLER (gated; odour is a top guest complaint), flag removed (issue control replaces it) | 4 |
| check_6_1 | Clean kitchen appliances | check_6_1 "Clean the kitchen: appliances inside and out, sink and faucet polished, counters wiped dry" | kept (DO-CONFIRM), absorbs check_6_4; disinfect; "See the standard" kitchen | 4 |
| check_6_4 | Disinfect and polish sink and counters | check_6_1 | merged (covers) | 4 |
| check_7_6 | Inspect utensils, flag damage | check_7_6 "Inspect utensils, plates, glasses and cookware; report chips, cracks or missing items" | kept alone (READ-DO), flag | 4 |
| check_7_7 | Refill supplies | check_7_7 "Replace the dish sponge, then refill bathroom and kitchen supplies to standard" | kept, absorbs check_6_5; triggersInventory kept | 4 |
| check_6_5 | Replace dishwashing sponge | check_7_7 | merged (covers) | 4 |
| check_8_1 | Vacuum then mop | check_8_1 "Vacuum, then mop, working back toward the door; wipe the balcony table, chairs and railing" | kept, absorbs check_balcony; disinfect | 5 |
| check_balcony | Wipe balcony | check_8_1 | merged (covers) | 5 |
| check_9_1 | Walkthrough as the guest | check_9_1 "Walk through as the guest and look for fingerprints, dust and smudges from different angles" | kept (DO-CONFIRM); "See the standard" living | 5 |
| check_vacuum_charge | Vacuum on charge, empty bin | check_vacuum_charge | kept (READ-DO), highlight | 5 |
| check_ecoflow_stowed | EcoFlow stowed, cable tidy | check_ecoflow_charge | merged into the existing Confirm & Leave line (covers) | 6 (gated) |
| check_10_6 | Final power and safety, windows closed, door locked | check_10_6 | kept, KILLER (gated, critical); shown in the Lock up set before the SmartLife line | 6 (gated) |

Counts: 37 ordinary ticks -> 19 ordinary lines (P2 6, P3 5, P4 5, P5 3) + 3 new gated killers (check_2_4, check_7_5, check_10_6) = 22 lines;
`covers` lists 15 absorbed ids; the other 22 old ids survive as lines (the 3 killers are among the 22; check_ecoflow_stowed is one of the 15 and is absorbed into the gated EcoFlow line).

## Gated items (confirm or report an issue), 7 to 9 per cleaning type, never more than the phase being left asks for

Existing Confirm & Leave set `CONFIRM_LEAVE_ITEMS` (unchanged ids, texts, `only:` logic; `confirmItemsNow()` unchanged: 6 for turnover and deep_clean,
4 for mid_stay and emergency): check_9_4, check_utensils_complete (turnover, deep_clean), check_ecoflow_charge (now also covers check_ecoflow_stowed),
check_key_card, check_guest_code, check_smartlife_waiting (turnover, deep_clean). The three new killers live in a separate `K_KILLER_ITEMS` array
(so the existing tests that pin the Confirm & Leave list stay true): check_2_4 (screen 2), check_7_5 (screen 4), check_10_6 (screen 6, shown before the
SmartLife line). `K_gatedAll()` is the union in the order the cleaner meets them; counts, issues, the e-mail and `checklistDetails` read that union.
Linen and smell are per type `['turnover','deep_clean','mid_stay']` (an emergency visit is not a clean); power and safety applies to every type.

| Cleaning type | Gated total | Of which new killers |
|---|---|---|
| turnover, deep_clean | 9 (6 + 3) | check_2_4, check_7_5, check_10_6 |
| mid_stay | 7 (4 + 3) | the same three |
| emergency | 5 (4 + 1) | check_10_6 only |

A screen gate asks only for ITS OWN gated items: 2 -> check_2_4; 4 -> supply log, kitchen photos (existing) and check_7_5; 5 -> the after-clean photos;
6 -> the Confirm & Leave set (existing `isPhase4Valid`) and check_10_6.

## Unchanged

Meter logic, photo minimums and sections (`section_meter`, `section_preclean`, `section_afterclean`), `issue_<itemId>` keys, `[URGENT]`, flags C/H/F/D/T
(the check_7_5 flag button is replaced by the Issue Found control, which writes the same `issue_` style note under Confirm & Leave), the weekly
tasks, `triggersInventory`, `confirmItemsNow()`, the submit payload keys, sign-in.
