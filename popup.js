// popup.js - Settings management for Survsay
document.addEventListener('DOMContentLoaded', () => {
    const micToggle = document.getElementById('floating-mic-toggle');
    const micPosition = document.getElementById('mic-position');
    const languageSelect = document.getElementById('transcription-language');
    const rewriteTone = document.getElementById('rewrite-tone');
    const rewriteLength = document.getElementById('rewrite-length');
    const resetButton = document.getElementById('reset-settings');

    const DEFAULTS = {
        micEnabled: true,
        micPosition: 'top-right',
        language: 'en-US',
        rewriteTone: 'original',
        rewriteLength: 'original'
    };

    // Load settings from storage and update the UI
    function loadSettings() {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            micToggle.checked = settings.micEnabled;
            micPosition.value = settings.micPosition;
            languageSelect.value = settings.language;
            rewriteTone.value = settings.rewriteTone;
            rewriteLength.value = settings.rewriteLength;
        });
    }

    // Save settings to storage
    function saveSettings() {
        const settings = {
            micEnabled: micToggle.checked,
            micPosition: micPosition.value,
            language: languageSelect.value,
            rewriteTone: rewriteTone.value,
            rewriteLength: rewriteLength.value
        };
        chrome.storage.sync.set(settings, () => {
            console.log('Survsay: Settings saved.');
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
            console.log('Survsay: Settings reset to defaults.');
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
    rewriteTone.addEventListener('change', saveSettings);
    rewriteLength.addEventListener('change', saveSettings);
    resetButton.addEventListener('click', resetSettings);

    // Listen for CSP block messages from the content script
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'CSP_BLOCKED') {
            document.querySelector('.settings-group').style.display = 'none';
            document.querySelector('.footer').style.display = 'none';
            document.getElementById('csp-warning').style.display = 'block';
        }
    });

    // Check for content script availability (CSP check)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'PING' }, (response) => {
                if (chrome.runtime.lastError || !response || !response.ok) {
                    // Content script is not available or didn't respond
                    document.querySelector('.settings-group').style.display = 'none';
                    document.querySelector('.footer').style.display = 'none';
                    document.getElementById('csp-warning').style.display = 'block';
                } else {
                    // Content script is available, load settings
                    loadSettings();
                }
            });
        }
    });
});
