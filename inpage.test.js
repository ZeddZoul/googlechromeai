// Unit tests for inpage.js

// Mock the LanguageModel API
const mockLanguageModel = {
  create: jest.fn(),
  availability: jest.fn(),
};

// Mock the window.postMessage function
const mockPostMessage = jest.fn();

// Set up the global scope with mocks
global.LanguageModel = mockLanguageModel;
global.atob = jest.fn();
global.MessageEvent = class {};

// Helper to dispatch messages
async function dispatchMessage(data) {
  const onMessage = global.window.addEventListener.mock.calls.find(call => call[0] === 'message')[1];
  await onMessage({ data });
}

describe('inpage.js', () => {
  beforeEach(() => {
    // Reset mocks and window object before each test
    jest.resetModules();
    jest.clearAllMocks();

    global.window = {
      postMessage: mockPostMessage,
      addEventListener: jest.fn(),
      __voxai_inpage_installed: false,
      __voxai_languageModelSession: null,
    };
    global.Blob = class {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options ? options.type : '';
      }
    };
    global.File = class {
      constructor(parts, filename, options) {
        this.parts = parts;
        this.filename = filename;
        this.type = options ? options.type : '';
      }
    };
    // Re-run the script to re-attach listeners and populate the new window
    require('./inpage.js');
  });

  test('ensureSession creates a session with expectedInputs', async () => {
    const mockSession = { prompt: jest.fn() };
    mockLanguageModel.create.mockResolvedValue(mockSession);

    const session = await window.__voxai_ensureSession();

    expect(mockLanguageModel.create).toHaveBeenCalledWith({
      monitor: expect.any(Function),
      expectedInputs: [{ type: 'audio' }],
    });
    expect(session).toBe(mockSession);
  });

  test('processes audio and returns structured data', async () => {
    const mockSession = { prompt: jest.fn() };
    mockLanguageModel.create.mockResolvedValue(mockSession);
    mockLanguageModel.availability.mockResolvedValue('available');
    const mockResponse = { transcription: 'hello world', structured: { foo: 'bar' } };
    mockSession.prompt.mockResolvedValue(JSON.stringify(mockResponse));

    await dispatchMessage({
      voxai: 'PROCESS_AUDIO_INPAGE',
      audioBuffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
      channel: 'test-channel',
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'test-channel',
      payload: { success: true, result: mockResponse },
    }, '*');
  });

  test('handles API unavailable with fallback transcript', async () => {
    mockLanguageModel.availability.mockResolvedValue('unavailable');

    await dispatchMessage({
      voxai: 'PROCESS_AUDIO_INPAGE',
      audioBuffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
      channel: 'test-channel',
      fallbackTranscript: 'fallback text',
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'test-channel',
      payload: { success: true, result: { transcription: 'fallback text', structured: {} }, source: 'fallback' },
    }, '*');
  });

  test('handles non-JSON response from prompt', async () => {
    const mockSession = { prompt: jest.fn() };
    mockLanguageModel.create.mockResolvedValue(mockSession);
    mockLanguageModel.availability.mockResolvedValue('available');
    mockSession.prompt.mockResolvedValue('just a string');

    await dispatchMessage({
      voxai: 'PROCESS_AUDIO_INPAGE',
      audioBuffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
      channel: 'test-channel',
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'test-channel',
      payload: { success: true, result: { transcription: 'just a string', structured: {} } },
    }, '*');
  });
});