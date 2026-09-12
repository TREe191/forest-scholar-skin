# Create Theme / Add Wallpaper

The entry card remains below the theme list. It opens a creation dialog: choose
a PNG/JPG with the native picker or drop one file only inside its drop zone.
The filename and preview appear before creation. Enter a name and confirm.
Choosing/dropping alone creates no package. Outside drops never create themes.
Canceling the dialog clears its in-memory image selection.

PNG bytes are copied unchanged. JPG is decoded and converted to a PNG copy by
Electron nativeImage, without resizing. This conversion can change encoding or
metadata; the source file is never modified. Input is limited to 20 MB and decoded
images to 8 million pixels. This is not an image editor.

The main process creates:

    themes/user-<uuid>/
      theme.json
      layout.json
      assets/background.png
      management.json

Names need not be unique. IDs are generated independently of names and paths.
No source paths enter renderer state or manifests. The package uses manifest v2,
one background for both appearances, no custom stylesheet, and a neutral contain
layout preserving the whole image. Existing payload analysis and adaptation
profiles are used when the theme is loaded for Codex; the GUI does not implement
another analyzer.

Packages are staged under runtime/theme-creation, validated by the existing
Theme Loader, then renamed into themes on the same filesystem. Failed staging
is removed. If the final catalog refresh fails after publication, Rescan themes
will discover the already-created package. A crash can leave an ignored staging
directory but cannot expose a partially staged package to the catalog.

Creation refreshes the catalog and selects the new theme for preview. It does
not Apply, launch Codex, or alter app.json. Select Apply explicitly when ready.
The UI displays a User badge from management.origin. New packages carry a
management.json sidecar (schemaVersion: 1, origin: user, protected: false,
deletable: true, renamable: true). This does not change the theme manifest or
loader format. readManagement is the policy adapter that can later consume
manifest metadata. Invalid/missing metadata defaults to protected, except for
the explicitly recognized legacy creator format (user UUID + Local user author).
Capabilities are a local management policy, not a trust/security signature.

Rename and Delete actions sit below each eligible theme card. Rename updates
only theme.json.name via temporary-file replacement. IDs and folders stay fixed.
Forest Scholar and Phainon are explicitly protected regardless of sidecar.
Universal Demo and Universal Dark Test are explicitly deletable development
packages. A protected flag overrides sidecar deletion/rename permissions.

Delete is disabled for the selected theme and active theme. Select a different
theme first; if active, Apply a different one as well. Main rechecks active state
after the native confirmation dialog. Apply and management mutations share an
IPC exclusion guard. Deletion moves the package into runtime/deleted-themes
with a unique suffix; it does not erase its files. To recover, move that directory
back to themes/<manifest id> while the destination is absent, then Rescan themes.
This recovery directory is ignored by Git and is not covered by history rotation;
deleting runtime manually will remove recovery copies.

Future UI cleanup can use a separate catalog presentation policy to label or
hide development IDs universal-demo and universal-dark-test. Do not infer
development status from Universal adaptation (user themes also use it), and do
not remove theme packages or change loading logic merely to filter the list.
No filtering is implemented in this version; explicit deletion is now available.

Tests exercise creation, copy/conversion boundaries with an injected converter,
staging failure, cancellation, IPC authorization, concurrency, loader/catalog,
profiles, and Chinese/space-containing paths. The actual native file picker and
Electron JPEG codec still require a GUI smoke test; tests never start Codex.
