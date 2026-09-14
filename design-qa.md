# Copper Busbar Page and Collapsible Sidebar — Design QA

## Evidence

- Source data table: `C:/Users/woaig/AppData/Local/Temp/codex-clipboard-5ab43b10-357e-4b66-928f-bbaec2f78523.png` (675 × 1158 px).
- Source calculation layout and values: `C:/Users/woaig/AppData/Local/Temp/codex-clipboard-51aba6f2-ff08-4ed2-9217-f9ecda228c94.png` (816 × 984 px).
- Source sidebar state: `C:/Users/woaig/AppData/Local/Temp/codex-clipboard-dbe949e2-8333-48ba-9134-fbf8062d3cc2.png` (1136 × 1097 px).
- Formula source: `工具模板/铜排载流量-A03.xlsx`, sheets `Calc!A1:C22` and `Data!A1:G98`.
- Implementation: `http://localhost:4173/`, captured in Chromium through Playwright at 1440 × 900 CSS pixels with device scale factor 1.
- Implementation screenshots: `output/playwright/sidebar-expanded-v211.png` and `output/playwright/sidebar-collapsed-v211.png` (both 1440 × 900 px).
- State: authenticated desktop project-workbench view, with the new explicit sidebar control tested in expanded and collapsed states. The earlier copper-busbar calculator evidence remains valid.
- Density normalization: the 1136 × 1097 source screenshot and 1440 × 900 implementation are different desktop crops, so comparison focused on the app-owned left navigation region and interaction state rather than pixel-for-pixel page width.

## Full-view comparison

- The new page follows the existing platform's navy, blue, white and pale-gray design tokens, card radii, input sizing and table density.
- The calculator preserves the four A03 inputs and makes the previously hidden coefficient and lookup-current steps visible without adding unsupported engineering assumptions.
- The data table retains all seven source columns, uses a sticky header and has its own vertical and horizontal scrolling region.
- The expanded sidebar matches the supplied platform structure and now starts with an unmistakable “收起导航” control. The collapsed state reduces it from 232px to a measured 70px icon rail, changes the control to a right-facing expand affordance, and preserves active-item highlighting and title tooltips.

## Focused comparison

- `1600A + 通风 + 光裸/全镀锡 + IEC增强(50K)` returned `80 x 10`, `单片`, `1240A`, `800mm²`, `400mm² PE`, coefficient `1.3`, lookup current `1230.8A`, and load rate `99.3%`, matching the A03 cached workbook values within display precision.
- The first data rows and the `80 x 10` row match the supplied Data-sheet screenshot. Filtering `80 x 10` returned the single, double, triple and quadruple configurations (4 of 97 records).
- Fonts and typography: passed. Existing Chinese system-font stack, sizes and hierarchy are preserved; no unexpected wrapping was visible.
- Spacing and layout rhythm: passed. Inputs align in four columns, results remain above the fold at the checked desktop size, and the collapsed rail releases useful table width.
- Colors and tokens: passed. Existing platform tokens are reused; the load-rate warning uses the established amber semantic treatment.
- Image and asset fidelity: passed. Existing iTeaQ brand artwork is preserved; navigation uses the application's existing Tabler icon sprite, with no placeholder image assets.
- Copy and content: passed. Labels match the A03 terminology and explain the data basis, interpolation records and Icw review boundary.
- Sidebar focused region: passed. Compared the supplied left-navigation screenshot with both saved implementation screenshots; font hierarchy, blue active state, white navigation surface and compact icon rhythm remain consistent, while the new control is an intentional functional addition.

## Primary interactions tested

- Opened the dedicated Copper Busbar page from the left navigation.
- Calculated the 1600A reference case.
- Switched between calculation and the 97-record data table.
- Filtered the table by `80 x 10` and verified four matching configurations.
- Collapsed the desktop sidebar and verified the table remained readable with the icon rail visible.
- Expanded the sidebar again and measured the rendered widths: 70px collapsed and 232px expanded.
- Automated module tests and the public-build privacy gate passed. No interaction failure was observed in the browser flow.
- Browser console check returned 0 errors and 0 warnings for the tested flow.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

## Comparison history

- First calculator capture: the 1600A result matched the workbook values and no P0/P1/P2 issue was found.
- Table capture: all columns were visible, the internal scrollbar worked, and no P0/P1/P2 issue was found.
- Earlier collapsed-sidebar capture: the icon rail worked, but the only desktop entry was an unlabeled top-bar icon, which the user correctly found insufficiently obvious.
- Fix: moved the desktop control into the top of the sidebar, added “收起导航 / 展开导航” state copy, directional icon rotation, and retained a separate top-bar trigger only for mobile.
- Post-fix evidence: `sidebar-expanded-v211.png` visibly shows the labeled control; `sidebar-collapsed-v211.png` shows the 70px rail and right-facing expand control. Playwright confirmed the rail expands back to 232px and the console remained clean.

## Final result

passed
