import {bindLayoutPreview} from './layout-preview.mjs';
import {editorLayoutConfig} from '../../shared/wallpaper-layout.mjs';
const previewRequests = new WeakMap();

function renderImage(elements, url) {
  const image = elements.image;
  if (url && previewRequests.get(image)?.url === url) return;
  const request = { url };
  previewRequests.set(image, request);
  image.onload = image.onerror = null;
  image.hidden = true;
  elements.placeholder.hidden = Boolean(url);
  if (!url) {
    image.removeAttribute("src");
    return;
  }
  const settle = available => {
    if (previewRequests.get(image) !== request) return;
    image.hidden = !available;
    elements.placeholder.hidden = available;
  };
  image.onload = () => settle(image.naturalWidth > 0);
  image.onerror = () => settle(false);
  image.src = url;
  if (image.complete) settle(image.naturalWidth > 0);
}

export function renderThemePreview(elements, theme, previewVariant) {
  const url = theme?.previews?.[previewVariant];
  renderImage(elements, typeof url === "string" && url.trim() ? url : null);
  bindLayoutPreview(elements.image,theme?.layoutConfig?.[previewVariant]??editorLayoutConfig({}));
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
  elements.image.alt = `${theme.name} ${previewVariant} background preview`;
  elements.name.textContent = theme.name;
  elements.version.textContent = `v${theme.version}`;
  elements.author.textContent = `by ${theme.author}`;
  elements.adaptation.textContent = `Visual adaptation: ${theme.visualAdaptation === "custom" ? "Custom" : "Universal"}`;
  elements.description.textContent = theme.description;
  elements.subtitle.textContent = `${previewVariant === "light" ? "Light" : "Dark"} background`;
}
