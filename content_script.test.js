/** @jest-environment jsdom */

// Mock Firebase Config
global.firebaseConfig = {
  apiKey: "test-key",
  authDomain: "test-domain",
  projectId: "test-project",
};

// Mock Firebase SDKs and chrome extension APIs
global.firebase = {
  app: {
    initializeApp: jest.fn(() => ({})),
  },
  ai: {
    getAI: jest.fn(() => ({
      getGenerativeModel: jest.fn(() => ({
        generateContent: jest.fn().mockResolvedValue({
          response: {
            text: () => 'This is a test transcription.',
          },
        }),
      })),
    })),
  },
};

global.chrome = {
  runtime: {
    getURL: jest.fn((path) => path),
    onMessage: {
      addListener: jest.fn(),
    },
  },
};

// Manually require the functions to be tested after setting up the DOM
const { analyzeForm, fillForm, getTranscription, blobToBase64 } = require('./content_script');

describe('Content script functionality', () => {
  // Set up the DOM before each test
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="name">Name</label>
        <input type="text" id="name" name="name" />
        <label for="email">Email</label>
        <input type="email" id="email" name="email" />
        <textarea id="message" name="message"></textarea>
      </form>
    `;
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
