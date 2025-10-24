/** @jest-environment jsdom */

// Load the script in a mock window environment
const fs = require('fs');
const path = require('path');

// Read the inpage.js script
const inpageScript = fs.readFileSync(path.join(__dirname, 'inpage.js'), 'utf-8');

// Mock LanguageModel API
const mockSession = {
  prompt: jest.fn(),
};

const mockLanguageModel = {
  create: jest.fn().mockResolvedValue(mockSession),
  availability: jest.fn().mockResolvedValue('readily'),
};

// Set up the global scope for the tests
beforeEach(() => {
  // Reset the window object for each test
  document.documentElement.innerHTML = '<head></head><body></body>';

  // Define LanguageModel in the window scope
  window.LanguageModel = mockLanguageModel;

  // Add a mock for postMessage
  window.postMessage = jest.fn();

  // Execute the inpage script
  const scriptEl = document.createElement('script');
  scriptEl.textContent = inpageScript;
  document.head.appendChild(scriptEl);

  // Reset mocks before each test
  mockSession.prompt.mockClear();
  mockLanguageModel.create.mockClear();
  window.postMessage.mockClear();
});

describe('inpage.js', () => {
  test('ensureSession creates a session with expected capabilities', async () => {
    // Dispatch a PROCESS_TEXT_INPAGE message to trigger session creation
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        voxai: 'PROCESS_TEXT_INPAGE',
        text: 'some text',
        schema: {},
        channel: 'test-channel',
      },
    }));

    // Wait for async operations to complete
    await new Promise(process.nextTick);

    // Check if LanguageModel.create was called with the correct options
    expect(mockLanguageModel.create).toHaveBeenCalledWith(expect.objectContaining({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    }));
  });

  test('processes audio and returns structured data', async () => {
    // Mock the prompt result
    const mockResult = '{"structured":{"name":"test"}}';
    mockSession.prompt.mockResolvedValue(`\`\`\`json\n${mockResult}\n\`\`\``);

    // The script should call prompt, but let's test the text processing part directly
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        voxai: 'PROCESS_TEXT_INPAGE',
        text: 'test transcription',
        schema: { fields: [] },
        channel: 'test-channel-text',
      },
    }));

    // Wait for async operations to complete
    await new Promise(process.nextTick);

    // Verify that postMessage was called with the correct data
    expect(window.postMessage).toHaveBeenCalledWith({
      channel: 'test-channel-text',
      payload: { success: true, result: { structured: { name: 'test' } } },
    }, '*');
  });

  test('handles API unavailable', async () => {
    // Mock the availability to be 'unavailable'
    mockLanguageModel.availability.mockResolvedValue('unavailable');

    // Dispatch a message to check for the on-device API
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        voxai: 'CHECK_ON_DEVICE',
        channel: 'test-channel-unavailable',
      },
    }));

    // Wait for async operations to complete
    await new Promise(process.nextTick);

    // Verify that postMessage was called with isAvailable: false
    expect(window.postMessage).toHaveBeenCalledWith({
      channel: 'test-channel-unavailable',
      payload: { isAvailable: false },
    }, '*');
  });

  test('handles non-JSON response from prompt', async () => {
    // Mock a non-JSON response
    mockSession.prompt.mockResolvedValue('this is not json');

    // Dispatch a message to process text
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        voxai: 'PROCESS_TEXT_INPAGE',
        text: 'some text',
        schema: {},
        channel: 'test-channel-non-json',
      },
    }));

    // Wait for async operations to complete
    await new Promise(process.nextTick);

    // Verify that postMessage was called with an error
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'test-channel-non-json',
      payload: expect.objectContaining({
        success: false,
        error: expect.stringContaining('Unexpected token'),
      }),
    }), '*');
  });
});
