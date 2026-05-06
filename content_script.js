let effect = null;

function activate() {
  if (effect) return;
  effect = new MembraneEffect();
  effect.mount();
}

function deactivate() {
  if (!effect) return;
  effect.destroy();
  effect = null;
}

chrome.storage.sync.get({ enabled: false }, ({ enabled }) => {
  if (enabled) activate();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled != null) {
    if (changes.enabled.newValue) activate();
    else deactivate();
  }
});
