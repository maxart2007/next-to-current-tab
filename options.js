const positionSelect = document.getElementById('position');
const avoidGroupsCheckbox = document.getElementById('avoidGroups');

function saveOptions() {
  chrome.storage.sync.set({
    position: positionSelect.value,
    avoidGroups: avoidGroupsCheckbox.checked,
  });
}

function restoreOptions() {
  chrome.storage.sync.get({ position: 'after', avoidGroups: false }, (items) => {
    positionSelect.value = items.position;
    avoidGroupsCheckbox.checked = items.avoidGroups;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
positionSelect.addEventListener('change', saveOptions);
avoidGroupsCheckbox.addEventListener('change', saveOptions);
