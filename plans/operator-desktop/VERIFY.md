# Verification

A single screenshot is not done. Exercise this as a person using a Mac. If items 3, 4, 6, or 7 fail, the work is not finished.

Sound checks need the speaker **on** and one click on the page first (Web Audio unlock).

## Checklist

1. **Load.** Desktop immediately — no full-page BIOS, no “press any key to skip”, no Boot menu. Wallpaper is a place (not black). Empty card says tools are live. Favicon and `<title>` look like a product. Offline pill uses existing `apiOnline` (no second indicator).

1b. **Computer boot.** Spawn: in-window overlay for the **entire** `starting` period (progress still moving after several seconds). Fade to VNC on `running`. Reload a running computer: no overlay. Failed spawn: fail line, then error chrome; red still destroys.

2. **Spawn.** Window eases in. Dock tile is a display mark with a monogram. Magnify feels continuous (no per-tile layout thrash). Cap tooltip reads `Limit of N computers reached`.

3. **Minimize / restore.** Yellow traffic light: window **flies into that computer’s dock tile**; tile bounces once; window gone. Click the tile: window **flies back out**. Repeat with the inspector **open** — dock still visible, FLIP still hits the tile. `prefers-reduced-motion: reduce`: instant hide/show, no flight.

4. **Maximize / arrange.** Green light interpolates. Edge-snap interpolates. Agent `workspace_arrange_windows` with `tile` interpolates. Unfocused VNC stays **full opacity**; only shadow/hairline change.

5. **Destroy.** Red light: approval sheet, no genie. If options include save-files, those choices are on the sheet (no extra route).

6. **Per-window Timeline.** With two computers, click **Timeline** on B’s titlebar: inspector opens on Tape, **only B’s lane**, newest B event selected, B is selected. Menubar Timeline shows All (two lanes). Canvas shrinks; dock remains. Both-shot event → **two separate images**, no drag-divider. `typeText` (shots skipped) → two placeholders. Esc closes the inspector.

7. **60 WPM type.** Agent `computer_type` a ~20 character string: keys appear in the guest at ~5/s; host plays a soft `typing` tick per character; the HTTP request stays open until the last key. Mute stops ticks immediately. A 200+ character string does not 502 at 15s.

8. **Recipes.** If `/api/actions` is up: Save as recipe from Tape → Recipes tab → Replay shimmers the selected window. A type step in a recipe is also paced.

9. **Cue restraint.** Approval = one `warning`. Spawn-at-cap = `blocked`. No sound on hover, boot probes, or tape arrivals.

10. **Offline.** Kill the API ~10s with the page open: windows stay mounted, Offline pill, inspector does not wipe computers.

11. **Viewports.** ~1280 and ~780 wide. Inspector resize persists across reload (`webmcp.insp-h`).

## Reduced motion

```css
@media (prefers-reduced-motion: reduce)
```

already zeroes animation duration. Confirm FLIP short-circuits (no half-flown window stuck at scale 0.1).
