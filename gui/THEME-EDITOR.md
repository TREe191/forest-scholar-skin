# Wallpaper modes and Universal overrides

## Duplicate / Customize a copy

Every valid catalog theme has Duplicate; protected themes show Customize a copy.
The existing authorized IPC/mutation lock calls ThemeDuplicator, which validates
the source and copies all manifest-declared layout, default/variant PNG and CSS
dependencies into private staging. No source resource references cross packages.
After validation, directory rename publishes a new user-UUID package with user
management permissions. Failure before publication removes staging.
Names use Copy, Copy (2), etc. The source is never written.
The new package is selected and opened in Edit without Apply or Launch.
Custom copies retain Custom CSS and layout: name/wallpapers can be edited, but
Universal palette controls are hidden and nonempty overrides rejected on save.
Original protected packages remain uneditable. Unreferenced stale assets,
diagnostic files and old checksums are not copied as dependencies.

## Applied content state

Catalog entries expose a SHA-256 contentRevision over the validated manifest,
resolved Light/Dark layout, both resolved image bytes and ordered theme CSS.
JSON object key order, file timestamps and machine-specific paths do not affect it.
Apply saves the theme ID, appearance and revision in config/.gui-applied.json
(local, Git-ignored), without extending app.json or changing launcher semantics.
Missing/unreadable receipts are treated as unapplied, including the first run
after upgrading. Apply once to establish the baseline.
Editor saves and catalog rescans compare content, not just ID. External file edits
are detected at the next Rescan/reopen; no filesystem polling is introduced.
Applied means saved configuration, not confirmation of live renderer hot reload.

Create and Edit use the same dialog and ThemeEditor.save model:
`{ id?, revision?, name, mode: "single" | "dual", tokens, paletteOverrides }`.
Image tokens are temporary capabilities; local paths never enter the renderer.
Single mode shows one Wallpaper slot; dual mode shows Light and Dark slots together.
Each slot supports preview, Choose/Replace, Clear and scoped drag/drop.
Empty dual slots explicitly show the other-image fallback. Mode switches retain
inactive selections until the editor closes; saving persists only the visible mode.
Switching into an empty mode seeds it from the existing wallpaper without replacing
previous selections. Shared draft tokens are released only when no slot uses them.
The file picker and scoped drop zone support PNG/JPG. PNG is unchanged; JPEG
becomes a PNG copy. Edit is only for manageable Universal user themes.

## Manifest v2 (backwards-compatible optional paletteOverrides)

```json
{
  "background": {
    "default": "assets/edit-UUID/light.png",
    "overrides": {
      "light": "assets/edit-UUID/light.png",
      "dark": "assets/edit-UUID/dark.png"
    }
  },
  "paletteOverrides": {
    "schemaVersion": 1,
    "light": { "accent": { "color": "#52687a", "alpha": 1 } },
    "dark": { "chromeSurface": { "color": "#202830", "alpha": 0.8 } }
  }
}
```

This is a manifest fragment, not a complete package. Single mode writes only
background.default. Dual mode writes only provided sides to overrides, and sets
default to the light image if supplied, otherwise dark. Both absent is rejected.
Thus missing light uses dark, missing dark uses light; no loader fallback change
is needed. Switching modes preserves temporary selections until dialog close;
only slots belonging to the saved mode are published.

Saving creates generation-named assets and validates with Theme Loader. New
packages publish by directory rename. Edit keeps the ID, directory, management
metadata and existing layout unchanged, and replaces only the manifest pointer
atomically after writing new assets. A revision check rejects stale editors.
Commit failure preserves the previous manifest and removes newly staged assets.
Old asset generations are deliberately retained; garbage collection is deferred.
Saving never applies or launches; the current window marks saved changes pending
Apply even when the ID is unchanged. This indicator is session-local.

## Palette semantics and extension boundary

Analysis -> adaptation profile -> Universal/base + compatibility CSS -> generated
user overrides -> existing mapped UI. No styles entry is generated: the theme
remains Universal, and analysis/profile still run. Custom CSS packages cannot
declare paletteOverrides; their behavior and ordering remain unchanged.

Allowed tokens: accent, foreground, foregroundMuted, sidebarSurface,
mainContentSurface, chromeSurface, topbarSurface, divider, scrim, topFade,
bottomFade. Each is a #RRGGBB color plus alpha in [0,1]. An unchecked/absent token
emits no declaration. Alpha 0 is an explicit transparent override, not unset.
The regular tokens override the corresponding existing --codex-skin variables;
they do not recolor every native descendant or syntax-highlight span globally.
topFade controls the existing MainContentTopFade color-to-transparent gradient;
it does not re-enable a fade hidden on Home. bottomFade controls the diagnosed
thread bottom gradient: strong=alpha, middle=alpha/3, clear=0 at existing stops.
No height, position, sticky behavior, or horizontal mask is changed.

The editor warns that user overrides can reduce contrast. Automatic correction
of user choices is not implemented. The main preview remains an image preview,
not a live simulation of all Codex UI surfaces.

`themes/palette.schema.json` is the stable JSON contract for future AI import.
Future Paste AI palette can parse JSON, validate the schema and call the same
validatePaletteOverrides function, fill the form, and save via ThemeEditor.
Unknown keys, CSS expressions, URLs, invalid colors/alphas/versions are rejected.
No AI/network/import UI is implemented now. Future regional recommendations
belong to versioned analysis/profile data, not arbitrary CSS or this v1 token
allowlist. A future focal editor can edit layout.json independently of palette.

PNG/JPG conversion and native interaction need GUI smoke testing. Unit tests use
an injected JPEG converter and never launch Codex.
