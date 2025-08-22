const positionRadios = document.querySelectorAll('input[name="position"]');
const groupPositionRadios = document.querySelectorAll('input[name="groupPosition"]');

function saveOptions() {
  const position = document.querySelector('input[name="position"]:checked').value;
  const groupPosition = document.querySelector('input[name="groupPosition"]:checked').value;
  chrome.storage.sync.set({ position, groupPosition });
}

function restoreOptions() {
  chrome.storage.sync.get({ position: 'after', groupPosition: 'after' }, (items) => {
    const pos = document.querySelector(`input[name="position"][value="${items.position}"]`);
    if (pos) pos.checked = true;
    const grp = document.querySelector(`input[name="groupPosition"][value="${items.groupPosition}"]`);
    if (grp) grp.checked = true;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  positionRadios.forEach((r) => r.addEventListener('change', saveOptions));
  groupPositionRadios.forEach((r) => r.addEventListener('change', saveOptions));
});
