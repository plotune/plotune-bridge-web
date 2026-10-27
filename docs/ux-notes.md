# UX notes

How the Bridge workspace takes its look from Plotune's public brand, and which workflow ideas it borrows from a reference measurement tool.

## 1. Brand source

The tokens come from the public [`plotune/plotune-web`](https://github.com/plotune/plotune-web) repository, **branch `master`, commit `f31745c`**, which holds the application source. The Plotune Stream workspace is the reference for chrome and components (`src/StreamWorkspace/`, `src/Stream/`).

> The `main` branch of `plotune-web` holds only the compiled build of an older, dark-themed site (teal `#26a69a` on `#121212`). None of its values are used here.

Everything is in one file, [`src/styles/tokens.css`](../src/styles/tokens.css). Each value there carries its source in a comment, and no colour is new. Pairs that Stream itself uses but that fall below WCAG AA for small text are not used for text; see section 3.

### Value to source

Source paths are relative to `plotune-web` at the commit above. Line numbers refer to that commit. Every row was checked automatically: the value appears on the cited line (or inside the cited range).

| Token | Value | Source |
|---|---|---|
| `--color-paper` | `#f7f6f2` | `src/index.css:11` |
| `--color-chrome` | `#eeeee6` | `src/StreamWorkspace/workspace.css:2018` |
| `--color-chrome-border` | `#cbd2c6` | `src/StreamWorkspace/workspace.css:2018` |
| `--color-panel` | `#ffffff` | `src/StreamWorkspace/workspace.css:519` |
| `--color-border` | `#d2d5ce` | `src/index.css:14` |
| `--color-row-rule` | `#e8eded` | `src/StreamWorkspace/workspace.css:531` |
| `--color-row-rule-soft` | `#edf0f1` | `src/StreamWorkspace/workspace.css:583` |
| `--color-ink` | `#1c242b` | `src/index.css:12` |
| `--color-text` | `#354249` | `src/StreamWorkspace/workspace.css:2033` |
| `--color-muted` | `#526067` | `src/StreamWorkspace/workspace.css:2017` |
| `--color-teal` | `#00796b` | `src/index.css:13` |
| `--color-teal-hover` | `#00695d` | `src/StreamWorkspace/workspace.css:451` |
| `--color-teal-link-hover` | `#005b50` | `src/StreamWorkspace/workspace.css:469` |
| `--color-on-teal` | `#fffffc` | `src/StreamWorkspace/workspace.css:2023` |
| `--color-violet` | `#5b62a7` | `tailwind.config.js:28` |
| `--color-teal-tint` | `#e7eee4` | `src/StreamWorkspace/workspace.css:2017` |
| `--color-violet-tint` | `#f1f1fa` | `tailwind.config.js:6` |
| `--button-border` | `#d7e0e1` | `src/StreamWorkspace/workspace.css:429` |
| `--button-text` | `#51656c` | `src/StreamWorkspace/workspace.css:431` |
| `--button-hover-bg` | `#eff5f3` | `src/StreamWorkspace/workspace.css:442` |
| `--button-hover-border` | `#c2d6d0` | `src/StreamWorkspace/workspace.css:443` |
| `--icon-text` | `#63757b` | `src/StreamWorkspace/workspace.css:208` |
| `--icon-hover-bg` | `#edf3f2` | `src/StreamWorkspace/workspace.css:212` |
| `--nav-text` | `#5b6b72` | `src/StreamWorkspace/workspace.css:287` |
| `--nav-hover-bg` | `#eef3f2` | `src/StreamWorkspace/workspace.css:295` |
| `--status-good-fg` | `#007968` | `src/StreamWorkspace/workspace.css:621` |
| `--status-good-bg` | `#eaf5f0` | `src/StreamWorkspace/workspace.css:622` |
| `--status-bad-fg` | `#ae4a42` | `src/StreamWorkspace/workspace.css:625` |
| `--status-bad-bg` | `#fbece9` | `src/StreamWorkspace/workspace.css:626` |
| `--status-warn-fg` | `#946b28` | `src/StreamWorkspace/workspace.css:629` |
| `--status-warn-bg` | `#fcf3e2` | `src/StreamWorkspace/workspace.css:630` |
| `--status-neutral-fg` | `#718188` | `src/StreamWorkspace/workspace.css:633` |
| `--status-neutral-bg` | `#eff3f4` | `src/StreamWorkspace/workspace.css:634` |
| `--text-good` | `#1f6e42` | `tailwind.config.js:14` |
| `--text-bad` | `#a8261f` | `tailwind.config.js:15` |
| `--text-warn` | `#7a5200` | `tailwind.config.js:16` |
| `--color-backdrop` | `#1c242b70` | `src/StreamWorkspace/workspace.css:2036` |
| `--shadow-menu` | `0 6px 20px #233a4020` | `src/Stream/stream.css:104` |
| `--shadow-dialog` | `0 20px 70px #24383f26` | `src/StreamWorkspace/workspace.css:1237` |
| `--color-dialog-border` | `#d5e0df` | `src/StreamWorkspace/workspace.css:1228` |
| `--font-sans` | `'Inter', system-ui, sans-serif` | `src/index.css:19` |
| `--font-mono` | `'Roboto Mono', ui-monospace, monospace` | `src/index.css:26` |
| `--text-base` | `13px` | `src/StreamWorkspace/workspace.css:12` |
| `--leading-base` | `1.5` | `src/StreamWorkspace/workspace.css:13` |
| `--text-h1` | `30px` | `src/StreamWorkspace/workspace.css:2026` |
| `--tracking-h1` | `-0.035em` | `src/StreamWorkspace/workspace.css:2026` |
| `--text-label` | `9px` | `src/StreamWorkspace/workspace.css:271` |
| `--tracking-label` | `1.2px` | `src/StreamWorkspace/workspace.css:272` |
| `--text-table-head` | `10px` | `src/StreamWorkspace/workspace.css:2032` |
| `--tracking-table-head` | `0.035em` | `src/StreamWorkspace/workspace.css:2032` |
| `--radius-control` | `2px` | `src/StreamWorkspace/workspace.css:2027-2028` |
| `--radius-input` | `5px` | `src/StreamWorkspace/workspace.css:67` |
| `--radius-badge` | `3px` | `src/StreamWorkspace/workspace.css:610` |
| `--radius-dialog` | `8px` | `src/StreamWorkspace/workspace.css:1229` |
| `--size-topbar` | `64px` | `src/StreamWorkspace/workspace.css:114` |
| `--size-setup` | `260px` | **Not from Stream.** Stream's sidebar is 218px (`workspace.css:219`); this list is wider to fit device names. |
| `--size-control` | `40px` | `src/StreamWorkspace/workspace.css:432` |
| `--pad-panel-head` | `13px 18px` | `src/StreamWorkspace/workspace.css:527` |
| `--pad-table-head` | `11px 18px` | `src/StreamWorkspace/workspace.css:578` |
| `--pad-table-cell` | `10px 18px` | `src/StreamWorkspace/workspace.css:582` |
| `--focus-ring` | `2px solid #00796b` | `src/StreamWorkspace/workspace.css:42` |
| `--focus-offset` | `3px` | `src/StreamWorkspace/workspace.css:43` |

### Logos, wordmark and fonts

| What | Here | Source in `plotune-web` |
|---|---|---|
| Logo mark | `src/assets/plotune-logo.png` (640 x 640 PNG, SHA-256 `94b5944779625e0d25bf1bb277137f0ab6df6083b63e78f243efff727eff34a8`) | `src/assets/logo.png` (identical to `public/assets/logo.png`), used by `src/StreamWorkspace/StreamWorkspace.jsx:1793` |
| Favicon | `public/favicon.ico` | `public/favicon.ico` |
| Wordmark | "Plotune" in ink (weight 650) with "Bridge" in teal (weight 400) | Stream renders `Plotune <span>Stream</span>` at `src/StreamWorkspace/StreamWorkspace.jsx:1792-1797`; styles at `src/StreamWorkspace/workspace.css:133-142`, with the final identity at `:2019-2020` |
| Sans typeface | Inter 400, 500, 600, 700 (Latin) | `src/index.css:19`; weights from the Google Fonts link in `public/index.html` |
| Mono typeface | Roboto Mono 400, 500 (Latin) | `src/index.css:26` |

`plotune-web` loads its fonts from Google Fonts. This site bundles the same families (via the `@fontsource` packages) so the page makes no third-party requests and its Content-Security-Policy can stay strict.

## 2. Layout and type conventions taken from Stream

- Light "paper" page, white panels with a 1 px rule, no shadows on panels, 2 px corner radius on panels, buttons and navigation; 5 px on inputs; 3 px on badges.
- 64 px top bar in the "chrome" tone. The left column is a device list (260 px, see below) in the same tone; Stream's solid-teal active navigation is no longer used for the window tabs, which follow the tab pattern instead (section 4).
- Panel head 53 px with a 13 px title at weight 650. (Stream's 30 px page head was dropped from workspace pages so the trace gets the room; see differences.)
- Table heads in 10 px uppercase Roboto Mono on the chrome tone.
- 13 px / 1.5 base text; small caps-style labels at 9 px with wide tracking.
- Focus ring: 2 px teal, 3 px offset.

### Deliberate differences from Stream

| Difference | Why |
|---|---|
| Buttons, inputs and table text use 12 px, not Stream's 11 px | Hex data and bit rates are read all day; 12 px is easier to read at the same control height. |
| Badge and status **text** uses the darker shades Stream defines for text (`--text-good`, `--text-bad`, `--text-warn`) and the muted ink for neutral, on Stream's own badge backgrounds | Stream's raw badge pairs measure 4.34:1 (warn) and 3.62:1 (neutral), below the 4.5:1 needed for small text. A test (`tests/tokens.test.ts`) checks every text pair and records this. |
| Channel chips use ink text with a teal or violet edge | Teal text on the teal tint is exactly at the 4.5:1 limit. Channel identity is the text (CAN1, CAN2); the colour is only a second cue. |
| Denser workspace: 10 px gaps and 12 px page padding instead of Stream's 20 px grid gap and 25/30 px page padding; no large page title | The Capture window has to show a trace and three working panels without scrolling on a laptop screen. |
| No dark theme | A light-theme workspace is the requirement. |

## 3. Accessibility checks that back these choices

- `tests/tokens.test.ts`: contrast of every foreground/background pair in the stylesheet, and that every colour token cites a source.
- `e2e/quality.spec.ts`: axe (WCAG 2.1 A and AA) on the explainer, address screen, a failure notice, every workspace page with live data, the panels menu, a takeover notice and a maximized panel; plus a full session with no console errors and no Content-Security-Policy violations.

## 4. Workflow reference

The maintainer's reference tool for measurement workflows is Vector CANoe. **Only workflow ideas were taken.** Nothing visual or textual was copied: no logo, icons, product name, screenshots or UI text. Icons are drawn for this product (`src/components/icons.tsx`) and labels are written in Plotune product language.

| Pattern taken | What it is here | What changed |
|---|---|---|
| **Trace window as a time-ordered table** with one row per frame | The Trace panel: Time, Channel, ID, Type, Dir, Len, Data. | Plain labels ("Std Data", "Remote", "Rx", "Tx"); time is seconds with microseconds, relative to the first frame and computed on 64-bit integers; the buffer is bounded and counts what scrolled out of view; no symbolic names or signal decoding. |
| **Channel column and per-channel conventions** | Every row is tagged CAN1 or CAN2 exactly as the device labels it; each channel has its own bit rate, termination switch and "include in capture" choice. | Channels are the product's two channels; termination is a software switch on the device (off by default). Colour is a secondary cue only. |
| **Measurement-style start and stop** | One toggle in the top bar: Start capture, Stop capture. Clear is separate. | Called "capture". Stopping delivers everything captured before the stop. A device can keep capturing while this page is disconnected, and the page says so on reconnect instead of pretending it stopped. |
| **Status and error indicators** | A connection state on each device card, a bus-state badge per channel, a statistics table, a "frames missing" badge. | Losing frames is a first-class state: the device reports drops per channel, the trace header shows a running total, and the trace carries a marker row where the report arrived. There is no bus-load percentage because the device does not report one. |
| **Several windows in one workspace, each maximizable** | Window tabs (Capture, Diagnostics, Device). On Capture the trace fills the top of the screen and Channels, Statistics and Send frame tile below it. Each panel can be maximized, shown full screen, and hidden from a Panels menu (remembered in the browser). | A fixed tiling, not free-form docking or detachable windows. |
| **A tree listing the measurement sources** | The Devices list on the left: one card per device with its state, address-derived name, channels (bit rate, capturing) and a Disconnect/Remove action. Selecting a device points Channels, Statistics, Send frame, Diagnostics and Device at it. | A flat list of devices, not a configuration tree. Channels are shown, but configured in the Channels panel. Up to eight devices. |
| **One trace for several sources** | With two or more devices the Trace gets a Device column and a source selector (All devices or one device). | Rows are merged in the order they **arrive on this page**, not by time. Device clocks are not synchronised, so each row's time is relative to **its own device's** first frame, and the trace says so. Nothing is interpolated or re-ordered. |
| **One start/stop for the whole measurement** | The top-bar Start capture / Stop capture acts on every connected device. | Each device keeps its own bit rates and results. A device that cannot start reports its own reason in its card. |
| **A dedicated transmit window** | The Send frame panel with channel, ID, format, type and data, and a log of recent sends. | One frame at a time: no periodic or triggered sending, no signal-based sending. Mistakes are explained before anything is sent. |
| **A separate diagnostics tool** | The Diagnostics page: link settings, generic diagnostic requests, and memory read/write over the calibration protocol. | Generic only. The seed is shown and the key is typed by the user; there are no flashing procedures or key algorithms. |

Not taken: any colour scheme, any icon or illustration, any menu or dialog wording, any keyboard shortcut set, the symbolic database concept, and the node/network configuration model.
