/** @jest-environment jsdom */

// Import the function to be tested
const { initializeVoxAIInpage } = require('./inpage.js');

describe('inpage.js', () => {
  let messageHandler;

  beforeEach(() => {
    // Reset DOM and global state before each test
    document.documentElement.innerHTML = '<head></head><body></body>';
    window.postMessage = jest.fn();
    delete window.__voxai_inpage_installed;
    delete window.__voxai_languageModelSession;
    delete global.LanguageModel;
  });

  afterEach(() => {
    // Clean up the event listener after each test
    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
    }
  });

  // Helper function to simulate message events
  const dispatchMessage = (data) => {
    const event = new MessageEvent('message', { data });
    window.dispatchEvent(event);
  };

  test('processes text and returns structured data', async () => {
    const mockSession = { prompt: jest.fn().mockResolvedValue('```json\n{"structured":{"name":"test"}}\n```') };
    global.LanguageModel = {
      create: jest.fn().mockResolvedValue(mockSession),
      availability: jest.fn().mockResolvedValue('available'),
    };

    messageHandler = initializeVoxAIInpage(); // Initialize the script

    dispatchMessage({
      voxai: 'PROCESS_TEXT_INPAGE',
      text: 'test transcription',
      schema: { fields: [] },
      channel: 'test-channel',
    });

    await new Promise(process.nextTick);

    expect(window.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'test-channel',
        payload: { success: true, result: { structured: { name: 'test' } } },
      }),
      '*'
    );
  });

  test('handles LanguageModel API not being present', async () => {
    // LanguageModel is not defined for this test
    messageHandler = initializeVoxAIInpage(); // Initialize the script

    dispatchMessage({
      voxai: 'PROCESS_TEXT_INPAGE',
      text: 'test transcription',
      schema: { fields: [] },
      channel: 'test-channel-fallback',
    });

    await new Promise(process.nextTick);

    expect(window.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'test-channel-fallback',
        payload: { success: false, error: 'Error: LanguageModel API not present' },
      }),
      '*'
    );
  });

  test('handles non-JSON response from prompt', async () => {
    const mockSession = { prompt: jest.fn().mockResolvedValue('this is not json') };
    global.LanguageModel = {
      create: jest.fn().mockResolvedValue(mockSession),
      availability: jest.fn().mockResolvedValue('available'),
    };

    messageHandler = initializeVoxAIInpage(); // Initialize the script

    dispatchMessage({
      voxai: 'PROCESS_TEXT_INPAGE',
      text: 'some text',
      schema: {},
      channel: 'test-channel-no-json',
    });

    await new Promise(process.nextTick);

    expect(window.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'test-channel-no-json',
        payload: { success: false, error: expect.stringContaining('SyntaxError: Unexpected token') },
      }),
      '*'
    );
  });

  test('checks for on-device availability correctly', async () => {
    global.LanguageModel = {
      create: jest.fn(),
      availability: jest.fn().mockResolvedValue('available'),
    };

    messageHandler = initializeVoxAIInpage(); // Initialize the script

    dispatchMessage({
        voxai: 'CHECK_ON_DEVICE',
        channel: 'check-channel',
    });

    await new Promise(process.nextTick);

    expect(window.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
            channel: 'check-channel',
            payload: { isAvailable: true },
        }),
        '*'
    );
  });
});