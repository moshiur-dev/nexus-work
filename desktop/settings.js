// Server address window. Talks to the main process through settings-preload.js.
const input = document.getElementById('url');
const err = document.getElementById('err');

window.nexusSettings.get().then(({ serverUrl, offline }) => {
  input.value = serverUrl;
  document.getElementById('offline').hidden = !offline;
  input.focus();
  input.select();
});

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const res = await window.nexusSettings.save(input.value.trim());
  if (!res.ok) err.textContent = res.error;
});

document.getElementById('cancel').addEventListener('click', () => window.nexusSettings.close());
