export function renderThemePreview(elements, theme, previewVariant) {
  const hasTheme = Boolean(theme);
  elements.image.hidden = !hasTheme;
  elements.placeholder.hidden = hasTheme;
  if (!theme) {
    elements.image.removeAttribute("src");
    elements.image.alt = "";
    elements.name.textContent = "—";
    elements.version.textContent = "";
    elements.author.textContent = "";
    elements.adaptation.textContent = "";
    elements.description.textContent = "";
    elements.subtitle.textContent = "Select a valid theme to inspect it.";
    return;
  }
  elements.image.src = theme.previews[previewVariant];
  elements.image.alt = `${theme.name} ${previewVariant} background preview`;
  elements.name.textContent = theme.name;
  elements.version.textContent = `v${theme.version}`;
  elements.author.textContent = `by ${theme.author}`;
  elements.adaptation.textContent = `Visual adaptation: ${theme.visualAdaptation === "custom" ? "Custom" : "Universal"}`;
  elements.description.textContent = theme.description;
  elements.subtitle.textContent = `${previewVariant === "light" ? "Light" : "Dark"} background`;
}
