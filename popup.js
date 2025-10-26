// popup.js - Settings management for VOX.AI
document.addEventListener('DOMContentLoaded', () => {
    const micToggle = document.getElementById('floating-mic-toggle');
    const micPosition = document.getElementById('mic-position');
    const languageSelect = document.getElementById('transcription-language');
    const resetButton = document.getElementById('reset-settings');

    const DEFAULTS = {
        micEnabled: true,
        micPosition: 'top-right',
        language: 'en-US'
    };

    // Load settings from storage and update the UI
    function loadSettings() {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            micToggle.checked = settings.micEnabled;
            micPosition.value = settings.micPosition;
            languageSelect.value = settings.language;
        });
    }

    // Save settings to storage
    function saveSettings() {
        const settings = {
            micEnabled: micToggle.checked,
            micPosition: micPosition.value,
            language: languageSelect.value
        };
        chrome.storage.sync.set(settings, () => {
            console.log('VOX.AI: Settings saved.');
            // Notify content scripts of the changes
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings });
                }
            });
        });
    }

    // Reset settings to default values
    function resetSettings() {
        chrome.storage.sync.set(DEFAULTS, () => {
            loadSettings();
            console.log('VOX.AI: Settings reset to defaults.');
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings: DEFAULTS });
                }
            });
        });
    }

    // Add event listeners
    micToggle.addEventListener('change', saveSettings);
    micPosition.addEventListener('change', saveSettings);
    languageSelect.addEventListener('change', saveSettings);
    resetButton.addEventListener('click', resetSettings);

    // Initial load
    loadSettings();
});
