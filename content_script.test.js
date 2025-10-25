/** @jest-environment jsdom */

// Mock the Firebase SDK
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({})),
}));

jest.mock('firebase/ai', () => ({
  getAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => 'This is a test transcription.',
        },
      }),
    })),
  })),
}));

// Manually require the functions to be tested after setting up the DOM
const { analyzeForm, fillForm, getTranscription, blobToBase64 } = require('./content_script');

describe('Content script functionality', () => {

  beforeEach(() => {
    // Reset the DOM and global state before each test
    document.documentElement.innerHTML = `
      <head></head>
      <body>
        <form>
          <label for="name">Name</label>
          <input type="text" id="name" name="name" />
          <label for="email">Email</label>
          <input type="email" id="email" name="email" />
          <textarea id="message" name="message"></textarea>
        </form>
      </body>
    `;

    // Mock the global firebaseConfig object
    global.window.firebaseConfig = {
      apiKey: "test-key",
      authDomain: "test-domain",
      projectId: "test-project",
    };

    // Mock chrome extension APIs
    global.chrome = {
      runtime: {
        getURL: jest.fn((path) => path),
        onMessage: {
          addListener: jest.fn(),
        },
      },
    };
  });

  test('analyzeForm should extract form schema correctly', () => {
    const schema = analyzeForm();
    expect(schema).toEqual({
      fields: [
        { name: 'name', type: 'input', inputType: 'text', label: 'Name' },
        { name: 'email', type: 'input', inputType: 'email', label: 'Email' },
        { name: 'message', type: 'textarea', inputType: 'textarea', label: '' },
      ],
    });
  });

  test('fillForm should fill form fields with structured data', () => {
    const data = {
      structured: {
        name: 'John Doe',
        email: 'john.doe@example.com',
        message: 'This is a test.',
      },
    };

    fillForm(data);

    expect(document.querySelector('[name="name"]').value).toBe('John Doe');
    expect(document.querySelector('[name="email"]').value).toBe('john.doe@example.com');
    expect(document.querySelector('[name="message"]').value).toBe('This is a test.');
  });

  test('getTranscription should call the Firebase AI SDK', async () => {
    const blob = new Blob(['test data'], { type: 'audio/webm' });
    const transcription = await getTranscription(blob);
    expect(transcription).toBe('This is a test transcription.');
  });

  test('blobToBase64 should convert a blob to a base64 string', async () => {
    const blob = new Blob(['test data'], { type: 'text/plain' });
    const base64 = await blobToBase64(blob);
    expect(base64).toBe('dGVzdCBkYXRh');
  });
});