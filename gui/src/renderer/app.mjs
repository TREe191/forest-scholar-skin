import { renderThemeList } from "./components/theme-list.mjs";
import { renderThemePreview } from "./components/theme-preview.mjs";
import { renderSettingsPanel } from "./components/settings-panel.mjs";
import { renderStatusBar } from "./components/status-bar.mjs";
import { legacyAppearanceToSkinAdaptation, skinAdaptationToLegacyAppearance } from "../shared/contracts.mjs";
import { PALETTE_TOKENS } from '../../../scripts/palette-overrides.mjs';
import { slotsFor, switchWallpaperMode, replaceWallpaper, renderWallpaperSlots } from './components/wallpaper-slots.mjs';
import { createEditorExitGuard } from './components/editor-exit-guard.mjs';
import {editorLayoutConfig} from '../shared/wallpaper-layout.mjs';
import {beginEditorSettings,changeEditorPolicy,policyLabel,themeSettingsAction,saveUnifiedDraft} from './components/editor-settings.mjs';
import { installUiPreferences } from './ui-preferences.mjs';

const api = window.themeManager;
installUiPreferences(document,api);
import { isSelectionDirty } from '../shared/applied-state.mjs';
const elements = {
  themeList: document.querySelector("#theme-list"),
  themeCount: document.querySelector("#theme-count"),
  invalidThemes: document.querySelector("#invalid-themes"),
  rescanButton: document.querySelector("#rescan-button"),
  previewButtons: [...document.querySelectorAll("[data-preview-variant]")],
  preview: {
    image: document.querySelector("#theme-preview"),
    placeholder: document.querySelector("#preview-placeholder"),
    name: document.querySelector("#theme-name"),
    version: document.querySelector("#theme-version"),
    author: document.querySelector("#theme-author"),
    adaptation: document.querySelector("#theme-adaptation"),
    description: document.querySelector("#theme-description"),
    subtitle: document.querySelector("#preview-subtitle"),
  },
  settings: {
    summary: document.querySelector('#adaptation-summary'),
    appliedNotice: document.querySelector('#applied-notice'),
    advancedButton: document.querySelector('#open-adaptation'),
    adaptationInputs: [...document.querySelectorAll('input[name="skin-adaptation"]')],
    advanced: document.querySelector("#advanced-adaptation"),
    compatibilityWarning: document.querySelector("#compatibility-warning"),
    forceWarning: document.querySelector("#force-warning"),
    pendingNotice: document.querySelector("#pending-notice"),
    applyButton: document.querySelector("#apply-button"),
    launchButton: document.querySelector("#launch-button"),
    restoreButton: document.querySelector("#restore-button"),
  },
  status: {
    bar: document.querySelector("#status-bar"),
    message: document.querySelector("#status-message"),
    summary: document.querySelector("#active-summary"),
  },
};

const state = {
  themes: [],
  invalidThemes: [],
  selectedTheme: null,
  activeTheme: null,
  applied: null,
  previewVariant: "light",
  skinAdaptation: "follow-codex",
  appliedSkinAdaptation: "follow-codex",
  operation: "loading",
  statusTone: "busy",
  statusMessage: "Loading Theme Packages…",
};

function selectedTheme() {
  return state.themes.find((theme) => theme.id === state.selectedTheme) || null;
}

function activeThemeName() {
  return state.themes.find((theme) => theme.id === state.activeTheme)?.name || null;
}

function isDirty() {
  return isSelectionDirty(selectedTheme(), state.activeTheme, skinAdaptationToLegacyAppearance(state.skinAdaptation), state.applied);
}

function isBusy() {
  return !["idle", "error"].includes(state.operation);
}

function renderInvalidThemes() {
  const count = state.invalidThemes.length;
  elements.invalidThemes.hidden = count === 0;
  elements.invalidThemes.replaceChildren();
  if (count === 0) return;
  const title = document.createElement("strong");
  title.textContent = `${count} invalid package${count === 1 ? "" : "s"}`;
  const detail = document.createElement("div");
  detail.textContent = state.invalidThemes.map((theme) => theme.folder).join(", ");
  elements.invalidThemes.append(title, detail);
  elements.invalidThemes.title = state.invalidThemes.map((theme) => `${theme.folder}: ${theme.message}`).join("\n");
}

function render() {
  const dirty = isDirty();
  const busy = isBusy();
  const theme = selectedTheme();
  if (theme && !theme.supportedAppearances.includes(state.previewVariant)) {
    state.previewVariant = theme.supportedAppearances[0];
  }
  elements.themeCount.textContent = String(state.themes.length);
  renderThemeList(elements.themeList, state.themes, {
    selectedTheme: state.selectedTheme,
    activeTheme: state.activeTheme,
    applied: state.applied,
    busy,
    onRename: openRename,
    onEdit: openEditor,
    onDuplicate: duplicateTheme,
    onDelete: deleteTheme,
    onSelect: async (themeId) => {
      if(createDialog.open && !await requestEditorExit())return;
      state.selectedTheme = themeId;
      setStatus("ready", dirtyMessage());
      render();
    },
  });
  renderInvalidThemes();
  for (const button of elements.previewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.previewVariant === state.previewVariant));
    button.disabled = busy || !theme || !theme.supportedAppearances.includes(button.dataset.previewVariant);
  }
  renderThemePreview(elements.preview, theme, state.previewVariant);
  renderSettingsPanel(elements.settings, {
    skinAdaptation: state.skinAdaptation,
    dirty,
    busy,
    theme,
  });
  elements.settings.advancedButton.textContent=themeSettingsAction(theme)==='copy'?'Customize a copy':'Theme settings…';
  elements.settings.advancedButton.disabled=busy||!theme;
  if(createDialog.open)syncEditorSettings();
  elements.rescanButton.disabled = busy;
  document.querySelector('#create-theme').disabled = busy;
  renderStatusBar(elements.status, {
    tone: state.statusTone,
    message: state.statusMessage,
    activeThemeName: activeThemeName(),
    skinAdaptation: state.appliedSkinAdaptation,
  });
}

function dirtyMessage() {
  return isDirty() ? "Selection changed. Apply before launching Codex." : "Ready.";
}

function setStatus(tone, message) {
  state.statusTone = tone;
  state.statusMessage = message;
}

function acceptBootstrap(result, { preserveSelection = false } = {}) {
  if (!result?.ok) throw new Error(result?.error || "Theme Manager state could not be loaded.");
  if(result.runtimeInfo){
    const info=result.runtimeInfo;
    for(const element of document.querySelectorAll('[data-developer-only]'))element.hidden=!info.developerControls;
    for(const element of document.querySelectorAll('[data-support-only]'))element.hidden=!info.supportDiagnostics;
    document.querySelector('#about-open').textContent=`v${info.version} · About`;
    document.querySelector('#about-version').textContent=`v${info.version} · ${info.mode}`;
    document.querySelector('#about-project').textContent=info.github;
  }
  state.themes = Array.isArray(result.themes) ? result.themes : [];
  state.invalidThemes = Array.isArray(result.invalidThemes) ? result.invalidThemes : [];
  state.activeTheme = result.config.activeTheme;
  state.applied = result.applied ?? null;
  state.skinAdaptation = legacyAppearanceToSkinAdaptation(result.config.appearance);
  state.appliedSkinAdaptation = state.skinAdaptation;
  const previousSelectionExists = preserveSelection && state.themes.some((theme) => theme.id === state.selectedTheme);
  state.selectedTheme = previousSelectionExists
    ? state.selectedTheme
    : state.themes.some((theme) => theme.id === state.activeTheme)
      ? state.activeTheme
      : state.themes[0]?.id || null;
  state.previewVariant = state.skinAdaptation === "force-dark" ? "dark" : "light";
  state.operation = "idle";
  if (!result.activeThemeValid) setStatus("error", "The configured activeTheme is not a valid loaded Theme Package.");
  else if (state.invalidThemes.length > 0) setStatus("ready", `Ready. ${state.invalidThemes.length} invalid package${state.invalidThemes.length === 1 ? " was" : "s were"} isolated.`);
  else setStatus("ready", dirtyMessage());
}

async function bootstrap() {
  try { acceptBootstrap(await api.getState()); }
  catch (error) {
    state.operation = "error";
    setStatus("error", error instanceof Error ? error.message : "Theme Manager failed to load.");
  }
  render();
}

async function runOperation(name, operation, successMessage) {
  state.operation = name;
  setStatus("busy", `${successMessage.replace(/\.$/, "")}…`);
  render();
  try {
    const result = await operation();
    if (!result?.ok) throw new Error(result?.error || `${successMessage} failed.`);
    state.operation = "idle";
    setStatus("ready", successMessage);
    return result;
  } catch (error) {
    state.operation = "error";
    setStatus("error", error instanceof Error ? error.message : "The operation failed.");
    return null;
  } finally {
    render();
  }
}

document.querySelector('#open-adaptation').addEventListener('click',()=>{
  const theme=selectedTheme();
  if(themeSettingsAction(theme)==='copy')void duplicateTheme(theme);
  else if(theme)void openEditor(theme);
});
document.querySelector('#about-open').addEventListener('click',()=>document.querySelector('#about-dialog').showModal());
document.querySelector('#about-close').addEventListener('click',()=>document.querySelector('#about-dialog').close());
document.querySelector('#support-open').addEventListener('click',()=>document.querySelector('#support-dialog').showModal());
document.querySelector('#support-close').addEventListener('click',()=>document.querySelector('#support-dialog').close());
document.querySelector('#support-export').addEventListener('click',async event=>{
  const button=event.currentTarget,result=document.querySelector('#support-result');button.disabled=true;
  try{const reply=await api.exportDiagnostics();result.textContent=reply.ok?(reply.canceled?'Export canceled.':'Diagnostics exported.'):'Diagnostics export failed. Original logs were not changed.';}
  catch{result.textContent='Diagnostics export failed. Original logs were not changed.';}
  finally{button.disabled=false;}
});

elements.rescanButton.addEventListener("click", async () => {
  const result = await runOperation("scanning", () => api.rescanThemes(), "Theme Packages rescanned.");
  if (result) refreshPreservingSelection(result);
  render();
});

for (const button of elements.previewButtons) {
  button.addEventListener("click", () => {
    state.previewVariant = button.dataset.previewVariant;
    render();
  });
}

for (const input of elements.settings.adaptationInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    changeEditorPolicy(editorSettings,input.value);
    syncEditorSettings();
  });
}

elements.settings.applyButton.addEventListener("click", async () => {
  const result = await runOperation(
    "applying",
    () => api.applyConfig({
      activeTheme: state.selectedTheme,
      appearance: skinAdaptationToLegacyAppearance(state.skinAdaptation),
    }),
    "Theme selection applied.",
  );
  if (result) {
    state.activeTheme = result.config.activeTheme;
    state.applied = result.applied ?? null;
    if(result.themes) state.themes = result.themes;
    state.appliedSkinAdaptation = legacyAppearanceToSkinAdaptation(result.config.appearance);
  }
  render();
});

elements.settings.launchButton.addEventListener("click", () => runOperation(
  "launching",
  () => api.launchCodex(),
  "Codex launch workflow completed.",
));

elements.settings.restoreButton.addEventListener("click", () => runOperation(
  "restoring",
  () => api.restoreCodex(),
  "Codex restore workflow completed.",
));

const createDialog = document.querySelector('#create-dialog');
let choosing=false, renameId=null;
let editorModel={mode:'single',images:{}};
let editorSettings=beginEditorSettings(state.skinAdaptation);
function syncEditorSettings(){
  document.querySelector('#editor-basic').hidden=editorSettings.view!=='basic';
  document.querySelector('#editor-advanced').hidden=editorSettings.view!=='advanced';
  document.querySelector('#editor-policy-summary').textContent='Adaptation: '+policyLabel(editorSettings.policy);
  const palette=getPalette();
  const count=Object.keys(palette.light??{}).length+Object.keys(palette.dark??{}).length;
  document.querySelector('#editor-palette-summary').textContent=editorModel.customStyles?'Palette: Custom theme CSS':count?'Palette: manual overrides enabled':'Palette: Universal automatic';
  for(const input of elements.settings.adaptationInputs){input.checked=input.value===editorSettings.policy;input.disabled=choosing||isBusy();}
  elements.settings.forceWarning.hidden=editorSettings.policy==='follow-codex';
  elements.settings.compatibilityWarning.hidden=true;
}
document.querySelector('#editor-advanced-open').addEventListener('click',()=>{
  editorSettings.view='advanced';syncEditorSettings();document.querySelector('#editor-advanced-back').focus();
});
document.querySelector('#editor-advanced-back').addEventListener('click',()=>{
  editorSettings.view='basic';syncEditorSettings();document.querySelector('#editor-advanced-open').focus();
});
const wallpaperMode=document.querySelector('#wallpaper-mode');
const layoutButtons=[...document.querySelectorAll('[data-wallpaper-layout]')];
for(const button of layoutButtons)button.addEventListener('click',()=>{
  if(choosing)return;
  editorModel.layoutMode=button.dataset.wallpaperLayout;setSlots();
});
const paletteRows=[];
for(const mode of ['light','dark']){
  const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=mode;group.append(legend);
  for(const token of Object.keys(PALETTE_TOKENS)){
    const row=document.createElement('label');row.className='palette-row';
    const enabled=document.createElement('input');enabled.type='checkbox';
    const caption=document.createElement('span');caption.textContent=token;
    const color=document.createElement('input');color.type='color';color.setAttribute('aria-label',`${mode} ${token} color`);
    const alpha=document.createElement('input');alpha.type='number';alpha.min='0';alpha.max='1';alpha.step='0.01';alpha.value='1';alpha.setAttribute('aria-label',`${mode} ${token} alpha`);
    enabled.addEventListener('change',()=>{color.disabled=alpha.disabled=!enabled.checked;});
    row.append(enabled,caption,color,alpha);group.append(row);paletteRows.push({mode,token,enabled,color,alpha});
  }document.querySelector('#palette-fields').append(group);
}
function setPalette(palette={}){for(const r of paletteRows){const v=palette[r.mode]?.[r.token];r.enabled.checked=!!v;r.color.value=v?.color??'#808080';r.alpha.value=String(v?.alpha??1);r.color.disabled=r.alpha.disabled=!v;}}
function getPalette(){const p={schemaVersion:1,light:{},dark:{}};for(const r of paletteRows)if(r.enabled.checked)p[r.mode][r.token]={color:r.color.value,alpha:Number(r.alpha.value)};return p;}
function hasImages(){return slotsFor(editorModel.mode).some(s=>editorModel.images[s]);}
function setSlots(){
  const current=editorLayoutConfig(editorModel).mode;
  for(const button of layoutButtons){button.disabled=choosing;button.setAttribute('aria-pressed',String(button.dataset.wallpaperLayout===current));}
  document.querySelector('#wallpaper-layout-note').textContent=current==='contain'?'Fit: show the whole image; empty edges are allowed.':current==='cover'?'Fill: cover the viewport; cropping is allowed.':current==='focus-soft'?'Focus: protect the existing focal region; new themes prioritize the center.':'Existing custom layout is preserved until you select a mode.';
  wallpaperMode.disabled=choosing;
  confirmCreate.disabled=choosing||!hasImages();
  renderWallpaperSlots(document.querySelector('#wallpaper-slots'),editorModel,{
    busy:choosing,choose:slot=>chooseImage(slot,()=>api.pickImage()),
    clear:async slot=>{
      if(choosing)return;
      const token=replaceWallpaper(editorModel,slot,null);
      setSlots();
      if(token)await api.clearImage(token);
    },drop:dropWallpaper
  });
}
wallpaperMode.addEventListener('change',()=>{
  if(choosing){wallpaperMode.value=editorModel.mode;return;}
  switchWallpaperMode(editorModel,wallpaperMode.value);setSlots();
});
const confirmCreate=document.querySelector('#create-confirm');
function resetImage(){editorModel={mode:'single',images:{}};document.querySelector('#wallpaper-error').textContent='';setSlots();}
async function chooseImage(slot,operation){
  if(choosing)return;choosing=true;setSlots();
  document.querySelector('#wallpaper-error').textContent='';
  try{const result=await operation();if(!result.ok)throw Error(result.error);if(result.image){
    const token=replaceWallpaper(editorModel,slot,result.image);
    if(token)await api.clearImage(token);
  }}
  catch(error){document.querySelector('#wallpaper-error').textContent=slot+': '+error.message;}
  finally{choosing=false;setSlots();}
}
// Prevent navigation everywhere; only this creation zone imports a dropped file.
document.addEventListener('dragover',event=>event.preventDefault());
document.addEventListener('drop',event=>event.preventDefault());
function dropWallpaper(slot,event){
  if(!createDialog.open||choosing)return;
  const files=[...event.dataTransfer.files];
  if(files.length!==1||files[0].size>20*1024*1024||! /\.(png|jpe?g)$/i.test(files[0].name)){document.querySelector('#wallpaper-error').textContent='Drop one PNG/JPG up to 20 MB.';return;}
  chooseImage(slot,async()=>api.dropImage(files[0].name,new Uint8Array(await files[0].arrayBuffer())));
}
const unsavedDialog=document.querySelector('#editor-unsaved-dialog');
function askEditorExit(){
  return new Promise(resolve=>{
    const finish=choice=>{
      unsavedDialog.close();
      unsavedDialog.oncancel=null;
      resolve(choice);
    };
    document.querySelector('#editor-exit-save').onclick=()=>finish('save');
    document.querySelector('#editor-exit-discard').onclick=()=>finish('discard');
    document.querySelector('#editor-exit-stay').onclick=()=>finish('stay');
    unsavedDialog.oncancel=event=>{event.preventDefault();finish('stay');};
    unsavedDialog.showModal();
    document.querySelector('#editor-exit-stay').focus();
  });
}
const editorExit=createEditorExitGuard({
  readDraft:()=>({name:document.querySelector('#create-name').value,mode:editorModel.mode,
    images:editorModel.images,paletteOverrides:getPalette(),policy:editorSettings.policy,layoutMode:JSON.stringify(['light','dark'].map(v=>editorLayoutConfig(editorModel,v)))}),
  ask:askEditorExit,save:saveEditorDraft,close:closeEditor,
});
async function requestEditorExit(){
  if(choosing)return false;
  return editorExit.request();
}
createDialog.addEventListener('cancel',event=>{event.preventDefault();void requestEditorExit();});
function closeEditor(){
  // Clean before another editor opens, not in the asynchronously dispatched close event.
  resetImage();api.clearImage();createDialog.close();
}
document.querySelector('#create-theme').addEventListener('click', async () => {
  if(createDialog.open && !await requestEditorExit())return;
  resetImage();
  editorModel={mode:'single',images:{}};wallpaperMode.value='single';setPalette();setSlots();
  editorSettings=beginEditorSettings(state.skinAdaptation);syncEditorSettings();
  document.querySelector('#palette-advanced').hidden=false;
  document.querySelector('#custom-copy-note').hidden=true;
  document.querySelector('#create-heading').textContent='Create Theme / Add Wallpaper';
  document.querySelector('#create-name').value = '';
  editorExit.begin();
  createDialog.showModal();
  document.querySelector('#create-name').focus();
});
document.querySelector('#create-cancel').addEventListener('click', () => {void requestEditorExit();});
document.querySelector('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  await saveEditorDraft();
});
async function saveEditorDraft(){
  const name = document.querySelector('#create-name').value.trim();
  if(isBusy()||choosing)return false;
  const invalid=document.querySelector('#create-form :invalid');
  if(invalid){editorSettings.view=invalid.closest('#editor-advanced')?'advanced':'basic';syncEditorSettings();}
  if (!name || !hasImages() || !document.querySelector('#create-form').reportValidity()) {
    document.querySelector('#wallpaper-error').textContent='Enter a theme name and choose at least one wallpaper; check palette values.';
    return false;
  }
  choosing=true;setSlots();
  document.querySelector('#create-form').inert=true;
  const model={id:editorModel.id,name,mode:editorModel.mode,tokens:Object.fromEntries(Object.entries(editorModel.images).map(([s,v])=>[s,v.token])),paletteOverrides:getPalette(),revision:editorModel.revision,layoutMode:editorModel.layoutMode};
  let savedPolicy=state.skinAdaptation;
  const result = await saveUnifiedDraft(editorSettings,()=>runOperation('saving', () => api.saveEditor(model), 'Theme saved.'),policy=>{savedPolicy=policy;});
  choosing=false;setSlots();
  document.querySelector('#create-form').inert=false;
  if (result?.canceled) setStatus('ready', 'Creation canceled. No theme was added.');
  else if (result) {
    closeEditor();
    acceptBootstrap(result);
    state.selectedTheme = result.created.id;
    state.skinAdaptation = savedPolicy;
    setStatus('ready', 'Theme saved and selected. Apply when ready; Codex was not restarted.');
  }
  render();
  if(!result || result.canceled){
    document.querySelector('#wallpaper-error').textContent=result?.canceled?'Save canceled. Your draft is still here.':state.statusMessage;
    return false;
  }
  return true;
}

function openRename(theme){renameId=theme.id;document.querySelector('#rename-name').value=theme.name;document.querySelector('#rename-dialog').showModal();}
async function openEditor(theme){
  if(createDialog.open && !await requestEditorExit())return;
  const result=await runOperation('loading',()=>api.loadEditor(theme.id),'Editor loaded.');if(!result)return;
  editorModel=result.model;wallpaperMode.value=editorModel.mode;setPalette(editorModel.paletteOverrides);setSlots();
  editorSettings=beginEditorSettings(state.skinAdaptation);syncEditorSettings();
  document.querySelector('#palette-advanced').hidden=Boolean(editorModel.customStyles);
  document.querySelector('#custom-copy-note').hidden=!editorModel.customStyles;
  document.querySelector('#create-name').value=editorModel.name;document.querySelector('#create-heading').textContent='Edit Theme';editorExit.begin();createDialog.showModal();
}

async function duplicateTheme(theme){
  if(createDialog.open && !await requestEditorExit())return;
  const result=await runOperation('duplicating',()=>api.duplicateTheme(theme.id),'Theme duplicated.');
  if(!result)return;
  const adaptation=state.skinAdaptation;
  acceptBootstrap(result);state.selectedTheme=result.created.id;state.skinAdaptation=adaptation;
  setStatus('ready','Independent copy created. Edit it, then Apply when ready.');render();
  await openEditor({id:result.created.id});
}
document.querySelector('#rename-cancel').addEventListener('click',()=>document.querySelector('#rename-dialog').close());
function refreshPreservingSelection(result){const adaptation=state.skinAdaptation;acceptBootstrap(result,{preserveSelection:true});state.skinAdaptation=adaptation;}
document.querySelector('#rename-form').addEventListener('submit',async event=>{
  event.preventDefault();if(isBusy())return;
  const name=document.querySelector('#rename-name').value.trim();if(!name)return;
  document.querySelector('#rename-dialog').close();
  const result=await runOperation('renaming',()=>api.renameTheme(renameId,name),'Theme renamed.');
  if(result)refreshPreservingSelection(result);render();
});
async function deleteTheme(theme){
  const result=await runOperation('deleting',()=>api.deleteTheme(theme.id,state.selectedTheme),'Theme removed from catalog.');
  if(result){refreshPreservingSelection(result);setStatus('ready',result.canceled?'Deletion canceled.':'Theme moved to recovery folder.');}render();
}

bootstrap();
