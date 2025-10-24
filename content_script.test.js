/** @jest-environment jsdom */

// Mocking chrome extension APIs
global.chrome = {
  runtime: {
    getURL: jest.fn((path) => path),
    onMessage: {
      addListener: jest.fn(),
    },
  },
};

// Manually require the functions to be tested after setting up the DOM
const { analyzeForm, fillForm } = require('./content_script');

describe('Form analysis and filling', () => {
  // Set up the DOM before each test
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="name">Name</label>
        <input type="text" id="name" name="name" />
        <label for="email">Email</label>
        <input type="email" id="email" name="email" />
        <textarea id="message" name="message"></textarea>
        <input type="hidden" name="hidden_field" value="hidden_value" />
        <input type="submit" value="Submit" />
      </form>
    `;
  });

  test('analyzeForm should extract form schema correctly', () => {
    const schema = analyzeForm();
    expect(schema).toEqual({
      fields: [
        {
          name: 'name',
          type: 'input',
          inputType: 'text',
          label: 'Name',
        },
        {
          name: 'email',
          type: 'input',
          inputType: 'email',
          label: 'Email',
        },
        {
          name: 'message',
          type: 'textarea',
          inputType: 'textarea',
          label: '',
        },
      ],
    });
  });

  test('fillForm should fill form fields with structured data', () => {
    const data = {
      structured: {
        name: 'John Doe',
        email: 'john.doe@example.com',
        message: 'This is a test message.',
      },
    };

    fillForm(data);

    expect(document.querySelector('[name="name"]').value).toBe('John Doe');
    expect(document.querySelector('[name="email"]').value).toBe('john.doe@example.com');
    expect(document.querySelector('[name="message"]').value).toBe('This is a test message.');
  });
});
