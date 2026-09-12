export const slotsFor = mode => mode === 'single' ? ['single'] : ['light', 'dark'];
export function switchWallpaperMode(model, mode) {
  if (!['single', 'dual'].includes(mode)) throw new Error('Invalid wallpaper mode');
  // Keep inactive selections for this editing session. Never overwrite an existing slot.
  if (mode === 'dual' && !model.images.light && !model.images.dark && model.images.single)
    model.images.light = model.images.single;
  if (mode === 'single' && !model.images.single)
    model.images.single = model.images.light ?? model.images.dark;
  if (!model.images.single) delete model.images.single;
  model.mode = mode;
}
export function replaceWallpaper(model, slot, image) {
  const old = model.images[slot];
  if (image) model.images[slot] = image;
  else delete model.images[slot];
  return old && !Object.values(model.images).some(v => v.token === old.token) ? old.token : null;
}
export function renderWallpaperSlots(container, model, {busy = false, choose, clear, drop}) {
  container.replaceChildren();
  for (const slot of slotsFor(model.mode)) {
    const doc = container.ownerDocument;
    const card = doc.createElement('section'); card.className = 'wallpaper-slot'; card.dataset.slot = slot;
    const title = doc.createElement('h3'); title.textContent = slot === 'single' ? 'Wallpaper' : `${slot === 'light' ? 'Light' : 'Dark'} wallpaper`;
    const selected = model.images[slot];
    const preview = doc.createElement('img'); preview.alt = `${title.textContent} preview`; preview.hidden = !selected;
    if (selected) preview.src = selected.preview;
    const name = doc.createElement('p'); if(selected)name.className='wallpaper-filename'; name.textContent = selected?.name ?? (slot === 'single' ? 'No image selected' : 'Not set — uses the other wallpaper as fallback');
    const pick = doc.createElement('button'); pick.type = 'button'; pick.disabled = busy;
    pick.textContent = selected ? 'Replace PNG/JPG' : 'Choose PNG/JPG'; pick.addEventListener('click', () => choose(slot));
    const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = 'Clear'; remove.disabled = busy || !selected;
    remove.addEventListener('click', () => clear(slot));
    const hint = doc.createElement('p'); hint.textContent = 'Or drag & drop one PNG/JPG here';
    card.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); if (!busy) drop(slot, event); });
    card.append(title, preview, name, pick, remove, hint); container.append(card);
  }
}
