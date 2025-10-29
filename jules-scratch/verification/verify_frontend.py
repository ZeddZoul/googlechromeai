
from playwright.sync_api import sync_playwright
import os
import time

def verify_survsay_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Listen for and print any console messages from the browser
        page.on("console", lambda msg: print(f"Browser Console: {msg.text()}"))

        # Intercept network requests for the scripts that content_script tries to inject.
        page.route("**/inpage.js", lambda route: route.fulfill(status=200, body=";"))
        page.route("**/firebase-injector.js", lambda route: route.fulfill(status=200, body=";"))

        # Grant microphone permissions
        context.grant_permissions(['microphone'])

        # Load the local test file
        html_file_path = f"file://{os.path.abspath('test.html')}"
        page.goto(html_file_path)

        # Mock necessary Chrome Extension APIs that content_script.js depends on
        page.add_init_script("""
            window.chrome = {
                runtime: {
                    getURL: (path) => path,
                    onMessage: { addListener: () => {} },
                },
                storage: {
                    sync: {
                        get: (defaults, callback) => callback({ micEnabled: true, micPosition: 'top-right' }),
                    },
                },
            };
            navigator.mediaDevices.getUserMedia = async () => ({
                getTracks: () => [{ stop: () => {} }],
            });
            window.MediaRecorder = class {
                constructor() { this.ondataavailable = null; this.onstop = null; }
                start() {}
                stop() { if (this.onstop) this.onstop(); }
                addEventListener() {}
            };
            window.AudioContext = class {
                constructor() {}
                createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
                createAnalyser() { return { connect: () => {}, disconnect: () => {} }; }
                close() {}
            };
            window.SpeechRecognition = class {
                constructor() {}
                start() {}
                stop() {}
            };
        """)

        # Inject the content script itself
        page.add_script_tag(path='content_script.js')
        time.sleep(1) # Give script time to run

        # Hover over the form to trigger the button's appearance
        form_locator = page.locator('#test-form')
        form_locator.hover()

        # Wait for the button to become visible
        button_locator = page.locator('.survsay-floating-mic')
        button_locator.wait_for(state='visible', timeout=5000)

        # Screenshot 1: Default State
        page.screenshot(path='jules-scratch/verification/default_state.png')

        # Click the button to enter the "recording" state
        button_locator.click()

        page.wait_for_selector('.survsay-recording', state='visible', timeout=5000)

        # Screenshot 2: Recording State
        page.screenshot(path='jules-scratch/verification/recording_state.png')

        browser.close()

if __name__ == '__main__':
    verify_survsay_button()
