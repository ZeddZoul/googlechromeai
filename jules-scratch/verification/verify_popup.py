from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Get the absolute path to popup.html
        file_path = os.path.abspath('popup.html')

        page.goto(f'file://{file_path}')
        page.screenshot(path='jules-scratch/verification/popup_ui.png')
        browser.close()

run()
