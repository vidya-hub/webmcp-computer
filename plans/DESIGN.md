# Axiom on this workspace

The workspace website is Axiom. The Linux desktops are not. XFCE may go light; this React app never does.

Substitute BerkeleyMono with **JetBrains Mono** (400 and 700). No Inter on nav, buttons, labels, feed rows, or headings.

## Tokens

Copy into `apps/web/src/styles/tokens.css` exactly:

```css
:root {
  --color-void: #000000;
  --color-carbon: #111111;
  --color-graphite: #191919;
  --color-iron: #202020;
  --color-slate: #3a3a3a;
  --color-pewter: #505050;
  --color-steel: #606060;
  --color-ash: #7e7e7e;
  --color-fog: #b4b4b4;
  --color-chalk: #d9d9d9;
  --color-paper: #eeeeee;
  --color-ember: #da5c2c;

  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-caption: 12px;
  --leading-caption: 1.5;
  --text-body: 14px;
  --leading-body: 1.71;
  --text-heading-sm: 18px;
  --leading-heading-sm: 1.56;
  --text-heading: 20px;
  --leading-heading: 1.4;

  --space-8: 8px;
  --space-16: 16px;
  --space-24: 24px;
  --space-32: 32px;
  --space-40: 40px;

  --radius: 2px;
}
```

## Where Ember is legal

1. Primary CTA fill (Approve, and no other filled button).
2. 2px left border on the **selected** machine card.
3. 2px left border on **agent** activity rows.

Do not put Ember on text, icons, iframe outlines, hover glows, or status dots.

## Surfaces

| Region | Fill | Border |
|--------|------|--------|
| page, nav | void | nav bottom 1px iron |
| machine list, iframe chrome | carbon | 1px iron |
| selected machine card, activity panel, approval card | graphite | 1px iron |
| nested quote / pending command block | carbon | none |

No box-shadow. No gradient. No radius above 2px except a 24px circular avatar if you add one (you will not).

## Type

| Role | Size | Weight | Color |
|------|------|--------|-------|
| nav wordmark, machine names | 14px | 400 | paper |
| page title | 20px | 400 | paper |
| body, feed, buttons | 14px | 400 | paper |
| helper, timestamps, os line | 12px | 400 | fog |
| inactive / stopped | 12–14px | 400 | steel |
| Approve | 16px | 700 | paper on Ember |
| Reject / ghost | 16px | 400 | paper, 1px slate border |

Every label is followed by `→` only on actions that go forward: Approve, Select, Open. Not on Reject.

## Status without color badges

Axiom bans green/red pills.

- WebMCP ready: `WebMCP  ready`
- WebMCP missing: `WebMCP  missing`
- machine running: `● nova` in paper
- machine stopped: `○ forge` in steel
- pending approval: `! approval` in paper, Ember left border on the dialog

## Layout

The host page is a macOS desktop. 100vw × 100vh. No marketing column. No activity rail.

```
menu 28px:  webmcp-computer    Action TimeLine              WebMCP  ready
---------------------------------------------------------------------------
desktop (canvas-bg)
  windows: 12px radius, traffic lights left, glass titlebar, VNC body
---------------------------------------------------------------------------
dock (floating):  [desk-a] [ci] [+]
```

Chrome type: system UI (`-apple-system`). Timeline Input/Output: JetBrains Mono.

Ember **only** on Approve. Selected window is a brighter hairline, not an Ember strip.

Iframe src: `/desktops/:id/?v=rfb`. Visual only. No `allow="tools"`.

## Buttons

Approve:

```
background Ember, color paper, 16px/700, radius 2px, pad 10px 16px, no shadow.
Label: Approve →
```

Reject and other secondary:

```
background transparent, 1px slate, color paper, 16px/400, radius 2px, pad 10px 16px.
Label: Reject
```

Machine select (unselected): ghost. Selected machine is not a filled Ember button. Selection is the 2px left border.

## Activity rows

```
16:04  AGENT  nova  ran  npm run dev
```

Monospace 14px. Timestamp fog. Actor uppercase steel. Agent rows get the Ember left border. Human rows get a 2px iron left border. System rows have no left border and steel text.

## Approval dialog

Centered glass sheet, 16px radius. Nested carbon command. Reject ghost left, Approve right (Ember fill).

## Linux wallpapers (phase 05)

These paint XFCE, not the website.

| id | What |
|----|------|
| `void` | `#000000` |
| `carbon` | `#111111` |
| `dark-grid` | `#000000` with `#202020` 32px grid |
| `arrows` | `#000000` with repeating `>` in `#3a3a3a` |

Nova boots on `carbon`. Forge boots on `dark-grid`.

## Forbidden

Gradients, drop shadows, 8px+ rounding, Inter on UI chrome, Ember as a text color, light sections on the website, photo backgrounds, colored success/error badges.
