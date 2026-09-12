# Theme Manager UI preferences

The compact language/appearance selectors in the main header control only Theme
Manager. They do not write app.json, Apply a theme or switch preview variants.

Preferences are stored in config/.gui-settings.json, relative to the resolved
project root, and ignored by Git. Default: English + System. Main owns validation
and serialized temporary-file/rename writes; renderer accesses only two scoped
IPC operations. Failed writes preserve the old setting. Missing/corrupt settings
use defaults; inaccessible files show a UI error.

System uses matchMedia('(prefers-color-scheme: dark)') and its change event.
Light/Dark explicitly select design tokens; both use the same layout. No polling
or Codex process interaction is involved.

src/shared/i18n.mjs contains English-keyed Chinese translations and controlled
templates. Main reuses it for native delete/file dialogs. ui-preferences.mjs is
the renderer localization boundary for static markup and dynamic components:
it remembers untranslated text, disconnects while translating to prevent loops,
and observes only this GUI DOM. Theme names/descriptions/filenames are excluded.
Language changes do not rerender/reset editor inputs or draft state.
Unrecognized low-level diagnostic text is retained rather than translated
incorrectly; the error-state label is localized.

Future GUI labels belong in the shared dictionary, not language branches inside
components. Future user-provided text must be marked data-i18n-skip (or an existing
excluded name/description/filename class). No theme manifest format changes.
