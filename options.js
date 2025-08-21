const positionSelect = document.getElementById('position');
const groupPositionSelect = document.getElementById('groupPosition');

function saveOptions() {
  chrome.storage.sync.set({
    position: positionSelect.value,
    groupPosition: groupPositionSelect.value,
  });
}

function restoreOptions() {
  chrome.storage.sync.get({ position: 'after', groupPosition: 'after' }, (items) => {
    positionSelect.value = items.position;
    groupPositionSelect.value = items.groupPosition;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
positionSelect.addEventListener('change', saveOptions);
groupPositionSelect.addEventListener('change', saveOptions);
