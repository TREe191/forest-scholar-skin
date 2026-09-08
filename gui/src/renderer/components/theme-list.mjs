export function renderThemeList(container, themes, { selectedTheme, activeTheme, onSelect }) {
  container.replaceChildren();
  for (const theme of themes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(theme.id === selectedTheme));
    button.dataset.themeId = theme.id;

    const name = document.createElement("span");
    name.className = "theme-item-name";
    name.textContent = theme.name;
    const version = document.createElement("span");
    version.className = "theme-item-version";
    version.textContent = `v${theme.version}`;
    button.append(name, version);

    if (theme.id === activeTheme) {
      const active = document.createElement("span");
      active.className = "active-badge";
      active.textContent = "Active theme";
      button.append(active);
    }
    button.addEventListener("click", () => onSelect(theme.id));
    container.append(button);
  }
}
