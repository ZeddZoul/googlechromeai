import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        extension_path = os.path.abspath('.')
        user_data_dir = '/tmp/test-user-data-dir'

        context = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=True,
            args=[
                f'--disable-extensions-except={extension_path}',
                f'--load-extension={extension_path}',
            ]
        )

        page = await context.new_page()

        test_html_path = os.path.abspath('jules-scratch/verification/test.html')
        await page.goto(f'file://{test_html_path}')

        await page.wait_for_selector('.survsay-rewriter-button', timeout=5000)

        await page.screenshot(path='jules-scratch/verification/verification.png')

        await context.close()

if __name__ == '__main__':
    asyncio.run(main())