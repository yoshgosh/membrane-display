const btn = document.getElementById('toggle');

function render(enabled) {
  btn.textContent = enabled ? 'エフェクト ON' : 'エフェクト OFF';
  btn.className = enabled ? 'on' : 'off';
}

chrome.storage.sync.get({ enabled: false }, ({ enabled }) => {
  render(enabled);
});

btn.addEventListener('click', () => {
  chrome.storage.sync.get({ enabled: false }, ({ enabled }) => {
    const next = !enabled;
    chrome.storage.sync.set({ enabled: next });
    render(next);
  });
});
