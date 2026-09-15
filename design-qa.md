# Design QA — v2.4.0

Status: PASS

## Reference and implementation

- Reference: disabled/empty “并列根数（S=d）” control in the supplied cable screenshot.
- Implementation: the control is an enabled 1–6 dropdown, matching Excel `G4`, with contextual text explaining whether it participates in the current correction formula.
- Reference: product database card followed by a large blank page area and tables that could not reach the final row.
- Implementation: the database card occupies the remaining viewport; each table owns its vertical scrolling and reaches its final row.

## Layout

- 1600×900: body scroll height equals viewport height (900px); database scroll panes are 284px high and both final rows are visible after scrolling.
- 1366×768: body scroll height equals viewport height (768px); database scroll panes are 218px high and both final rows are visible after scrolling.
- Sidebar stays fixed and readable; the database card fills the workspace without the previous lower-page dead space.

## Typography and hierarchy

- Existing platform type scale, spacing, colors and card hierarchy are preserved.
- The new dropdown hint uses secondary text styling and does not compete with the current correction-factor card.

## Interaction and accessibility

- “并联根数” remains a 1–4 dropdown; “并列根数（S=d）” is selectable from 1–6 under every condition.
- Selecting a value under an inapplicable condition leaves the current formula unchanged and provides an explicit explanation.
- Product information and technical-specification tables retain independent horizontal and vertical scrolling.
- The sidebar, project flow and tool center expose no “编码与交付” entry; the template center remains available.
- Browser console: 0 errors, 0 warnings during the verified flows.

## Intentional differences

- The Excel workbook can retain a value that is ignored by its conditional formula. The web UI makes that state visible with a hint, instead of disabling the input or silently accepting it.
- “编码与交付” is hidden from current navigation by product decision; its implementation is retained for later restoration.
