# Wallpaper layout

Create/Edit exposes Fit (`contain`), Fill (`cover`) and Focus (`focus-soft`). New editor-created themes default to Fit. Both wallpaper slots share the mode. A missing dual slot previews the other wallpaper as fallback.

New themes use a neutral central focal region `{x:0.25,y:0.15,width:0.5,height:0.7}`, centered anchor, zero safe padding, tolerance 0.08, scale 1 and no manual offset/scale limits. This is not subject recognition. Existing theme focal geometry and tuning are preserved; choosing a mode changes only the mode. Legacy per-variant parameters remain intact, and an unrepresented legacy mode (e.g. focus-lock) is preserved until explicitly replaced.

`src/shared/wallpaper-layout.mjs` prepares configuration using the existing layout resolver. `src/renderer/components/layout-preview.mjs` delegates all geometry to `scripts/layout-engine.mjs`, for both editor slots and the main preview. ResizeObserver batches rendering through requestAnimationFrame; no second scaling algorithm is used. Different viewport aspect ratios can naturally produce different crops.

New packages write layout.json. An edited layout is published as `assets/edit-<uuid>/layout.json` and referenced by the atomic theme.json update, together with that generation's images. Failed publication retains the old manifest/images/layout. Old unreferenced generations are retained, not deleted by this operation.

No loader, injector, adaptation or engine semantics change. Layout changes participate in unsaved-draft protection and the existing content revision after save.
