# Copper Busbar Page and Collapsible Sidebar — Design QA

## Evidence

- Source data table: `C:/Users/woaig/AppData/Local/Temp/codex-clipboard-5ab43b10-357e-4b66-928f-bbaec2f78523.png` (675 × 1158 px).
- Source calculation layout and values: `C:/Users/woaig/AppData/Local/Temp/codex-clipboard-51aba6f2-ff08-4ed2-9217-f9ecda228c94.png` (816 × 984 px).
- Source sidebar state: `C:/Users/woaig/AppData/Local/Temp/codex-clipboard-dbe949e2-8333-48ba-9134-fbf8062d3cc2.png` (1136 × 1097 px).
- Formula source: `工具模板/铜排载流量-A03.xlsx`, sheets `Calc!A1:C22` and `Data!A1:G98`.
- Implementation: `http://localhost:4173/`, captured and inspected in the Codex in-app browser at 1265 × 710 CSS pixels. The browser integration displayed the capture in-session but did not expose a persistent screenshot path.
- State: authenticated desktop view; copper-busbar calculator with the 1600A sample, complete table view, filtered table view, and collapsed sidebar view.

## Full-view comparison

- The new page follows the existing platform's navy, blue, white and pale-gray design tokens, card radii, input sizing and table density.
- The calculator preserves the four A03 inputs and makes the previously hidden coefficient and lookup-current steps visible without adding unsupported engineering assumptions.
- The data table retains all seven source columns, uses a sticky header and has its own vertical and horizontal scrolling region.
- The expanded sidebar matches the supplied platform structure. The collapsed state reduces it to a 70px icon rail while preserving the active-item highlight and title tooltips.

## Focused comparison

- `1600A + 通风 + 光裸/全镀锡 + IEC增强(50K)` returned `80 x 10`, `单片`, `1240A`, `800mm²`, `400mm² PE`, coefficient `1.3`, lookup current `1230.8A`, and load rate `99.3%`, matching the A03 cached workbook values within display precision.
- The first data rows and the `80 x 10` row match the supplied Data-sheet screenshot. Filtering `80 x 10` returned the single, double, triple and quadruple configurations (4 of 97 records).
- Fonts and typography: passed. Existing Chinese system-font stack, sizes and hierarchy are preserved; no unexpected wrapping was visible.
- Spacing and layout rhythm: passed. Inputs align in four columns, results remain above the fold at the checked desktop size, and the collapsed rail releases useful table width.
- Colors and tokens: passed. Existing platform tokens are reused; the load-rate warning uses the established amber semantic treatment.
- Image and asset fidelity: passed. Existing iTeaQ brand artwork is preserved; navigation uses the application's existing Tabler icon sprite, with no placeholder image assets.
- Copy and content: passed. Labels match the A03 terminology and explain the data basis, interpolation records and Icw review boundary.

## Primary interactions tested

- Opened the dedicated Copper Busbar page from the left navigation.
- Calculated the 1600A reference case.
- Switched between calculation and the 97-record data table.
- Filtered the table by `80 x 10` and verified four matching configurations.
- Collapsed the desktop sidebar and verified the table remained readable with the icon rail visible.
- Automated module tests and the public-build privacy gate passed. No interaction failure was observed in the browser flow.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the current browser tool did not persist its visual capture as a local PNG; the live browser capture and accessibility tree were used for this QA record.

## Comparison history

- First calculator capture: the 1600A result matched the workbook values and no P0/P1/P2 issue was found.
- Table capture: all columns were visible, the internal scrollbar worked, and no P0/P1/P2 issue was found.
- Collapsed-sidebar capture: the icon rail and expanded workspace were both visible, with no content overlap or clipped persistent control.

## Final result

passed
