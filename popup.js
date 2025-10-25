document.addEventListener('DOMContentLoaded', () => {
    const recordButton = document.getElementById('record-button');
    const statusDiv = document.getElementById('status');
    const reloadButton = document.getElementById('reload-button');

    let recording = false;
    let processing = false;

    // Function to update button UI based on state
    function updateButtonUI() {
        if (processing) {
            recordButton.className = 'processing';
            statusDiv.textContent = 'Processing...';
            recordButton.disabled = true;
        } else if (recording) {
            recordButton.className = 'recording';
            statusDiv.textContent = 'Recording...';
            recordButton.disabled = false;
        } else {
            recordButton.className = 'ready';
            statusDiv.textContent = 'Ready to record';
            recordButton.disabled = false;
        }
    }

    // Function to send messages to content script
    async function sendMessageToContentScript(message) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && typeof tab.id !== 'undefined') {
            return new Promise((resolve) => {
                chrome.tabs.sendMessage(tab.id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response);
                    }
                });
            });
        }
    }

    // Event listener for the record button
    recordButton.addEventListener('click', async () => {
        if (processing) return;

        if (recording) {
            // Stop recording
            const response = await sendMessageToContentScript({ type: 'STOP_RECORDING' });
            if (response && response.success) {
                recording = false;
                processing = true;
                updateButtonUI();
                // Note: The UI will be reset to "Ready" when processing is complete,
                // which we can't directly track here. We'll assume it takes a few seconds.
                setTimeout(() => {
                    processing = false;
                    updateButtonUI();
                }, 4000);
            }
        } else {
            // Start recording
            const response = await sendMessageToContentScript({ type: 'START_RECORDING' });
            if (response && response.success) {
                recording = true;
                updateButtonUI();
            }
        }
    });

    // Event listener for the reload button
    reloadButton.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && typeof tab.id !== 'undefined') {
            try {
                await chrome.tabs.reload(tab.id);
            } catch (err) {
                console.error('Failed to reload tab:', err);
            }
        }
    });

    // Initial UI state
    updateButtonUI();
});
