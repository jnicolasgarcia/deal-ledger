# Data assumptions

Source of truth for how `data/source.xlsx` becomes the shared dataset.
If a rule changes, change it here first. Evidence comes from
`scripts/profile_workbook.py`.

## 1. Status mapping

Canonical stages in funnel order: Sourcing, In Pipeline, Pre LOI,
Negotiating LOI, Negotiating PSA, In Contract, Closed. Plus On Hold
(paused, not lost) and Unknown (blank or unmappable).

Lookup is case-insensitive. The raw value is trimmed, repeated spaces are
collapsed to one, and it is compared in lowercase with the raw values
below. So `NEGOTIATING PSA` maps to Negotiating PSA without a new row.
A spelling that still doesn't match maps to Unknown and is flagged until
it is added here. `stage_raw` always keeps the original value, unchanged.

The table lists every spelling found in the workbook. The case variants
stay listed as evidence; the lookup doesn't need them.

| Raw value (as written) | Canonical stage | Confidence | Reason |
|---|---|---|---|
| `Sourcing` | Sourcing | High | Exact stage name |
| `sourcing` | Sourcing | High | Case variant |
| `SOURCING` | Sourcing | High | Case variant |
| `In Pipeline` | In Pipeline | High | Exact stage name |
| `in pipeline` | In Pipeline | High | Case variant |
| `pre loi` | Pre LOI | High | Case variant |
| `Negotiating LOI` | Negotiating LOI | High | Exact stage name |
| `Negotiating PSA` | Negotiating PSA | High | Exact stage name |
| `nego PSA` | Negotiating PSA | High | Abbreviation; target_weekly_view shows this row as "Negotiating PSA" |
| `In Contract` | In Contract | High | Exact stage name |
| `Under Contract` | In Contract | Medium | Synonym; the note confirms a closing date and a deposit |
| `On Hold` | On Hold | High | Exact stage name |
| `Listed` | Unknown (flagged) | n/a | Not an acquisition stage; "market prep" suggests the client is selling |
| blank | Unknown | n/a | No stage in the source |

No source row is currently Closed.

## 2. Vertical rule

The vertical comes from the tab name prefix (the text before the first `_`).
The labels come from target_weekly_view.

| Tab prefix | Vertical | Tab in this workbook |
|---|---|---|
| `food` | Food | food_clientA_nyc |
| `av` | Autonomous Vehicle | av_clientC_atl |
| `catering` | Airline Catering | catering_clientB_jfk |

- `contact_tracker` and `target_weekly_view` are known non-deal tabs, so
  this rule doesn't apply to them.
- A tab whose prefix isn't in the table is reported, never skipped. Its
  rows are imported with vertical Unknown (shown as n/a).
- Client name is only a consistency check. If a row's Client name doesn't
  match the client part of the tab name (`clientA` = "Client A"), or a tab
  has more than one Client name, that is reported. The vertical doesn't
  change.

## 3. Assumption rule

A data cell whose font color is rgb `FF0000FF` (blue) is an assumption:
a value entered before confirmed data exists. Its value is kept as written
and its column name goes in `assumption_fields`. It stays flagged until
someone confirms it.

This rule rests on a single cell: `av_clientC_atl!O2` (Power = `400A`).
All other data cells use the default color (theme 1, no tint). A cell in
any other non-default color is reported, not treated as an assumption.

## 4. Column mapping (target_weekly_view)

The same mapping holds in all three client tabs.

| Weekly column | Source column | Note |
|---|---|---|
| Vertical | none | From the tab prefix (section 2) |
| Market | Metro | The client's search market, not the property's City |
| Address | Address | |
| Status | Status | Canonical stage (section 1) |
| $ | List Price | |
| SF | Bldg SF | |
| $/SF | List Price/SF | Source value, not recalculated |
| Lot Size | Lot SF | |
| Notes | Notes | Raw source note (section 5) |

target_weekly_view is an example of the shape, not a filter. It includes
6 of 18 deal rows with no stage rule we can see. Its notes are shortened
by hand and its blanks are shown as `-`. The app shows the raw note and
shows n/a for blanks.

## 5. Other rules

- **Blank or unmappable stage:** keep the row, stage Unknown, raw value kept
  in `stage_raw`. Flagged when the value isn't blank.
- **No address:** keep the row with address null. `natural_key` falls back to
  `source_tab:source_row` and the fallback is reported. City and State stay
  separate from Market.
- **Text in numeric fields:** keep the raw text. Parse only when the
  meaning is unambiguous: a plain number, optionally with `$` or thousands
  commas. Units, ranges or words (`15-51`, `2,400A`) stay text, and the
  numeric value stays null.
- **Blank Client name:** fall back to the client part of the tab name
  (`food_clientA_nyc` gives "Client A") and flag it as an issue. It's
  derived from the tab, not invented.
- **State:** a typed column next to City, but nullable, because the food
  tab doesn't have it.
- **Vertical-specific fields** (Power, Clear height, Zoning, Miles from Airport
  and others): kept raw in `attributes`, not parsed.
- **Notes:** kept raw. No prices, dates or terms are extracted from them.
- **Sale Status and Days On Market:** these describe the property's listing.
  Attributes only, never used for the stage or for stage dates.
  `stage_changed_at` is null on import.
