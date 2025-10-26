/**
 * @jest-environment jsdom
 */

// --- Mocks ---

global.chrome = {
    runtime: {
        getURL: jest.fn(path => `chrome-extension://mock/${path}`),
        onMessage: { addListener: jest.fn() },
    },
    storage: {
        sync: {
            get: jest.fn((defaults, callback) => callback(defaults)),
            set: jest.fn((items, callback) => callback()),
        },
    },
};

global.navigator.mediaDevices = {
    getUserMedia: jest.fn(() => Promise.resolve({
        getTracks: () => [{ stop: jest.fn() }],
    })),
};

// Mock AudioContext and related APIs
global.AudioContext = jest.fn(() => ({
    createMediaStreamSource: () => ({ connect: jest.fn(), disconnect: jest.fn() }),
    createAnalyser: () => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
        getByteTimeDomainData: jest.fn(),
    }),
    close: jest.fn(),
}));
global.MediaRecorder = jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
}));
global.SpeechRecognition = jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
}));
global.requestAnimationFrame = jest.fn();


// --- Tests ---

const {
    attachMicsToForms,
    removeAllMics,
    getSurroundingText,
    handleStartRecording,
    handleStopRecording,
    recordingState,
    analyzeForm,
    fillForm,
} = require('./content_script');

describe('VOX.AI Content Script', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div>Some text before the form</div>
            <form id="form1">
                <label for="field1">Field 1</label>
                <input id="field1" name="field1" type="text" />
            </form>
        `;
        // Reset state
        Object.assign(recordingState, {
            isRecording: false, isInitializing: false, isStopping: false,
            activeForm: null, currentStream: null,
        });
        jest.clearAllMocks();
    });

    test('should attach mics to all forms', () => {
        attachMicsToForms();
        expect(document.querySelectorAll('.voxai-floating-mic').length).toBe(1);
    });

    test('should remove all mics from the page', () => {
        attachMicsToForms();
        removeAllMics();
        expect(document.querySelectorAll('.voxai-floating-mic').length).toBe(0);
    });

    test('should get surrounding text', () => {
        const form = document.getElementById('form1');
        expect(getSurroundingText(form)).toBe('Some text before the form');
    });

    test('should handle start and stop recording', async () => {
        const form = document.getElementById('form1');
        const mic = document.createElement('div');
        await handleStartRecording(mic, form);
        expect(mic.classList.contains('voxai-recording')).toBe(true);
        expect(recordingState.activeForm).toBe(form);
        await handleStopRecording(mic);
        expect(mic.classList.contains('voxai-recording')).toBe(false);
    });

    test('should analyze a form and return a schema', () => {
        const form = document.getElementById('form1');
        const schema = analyzeForm(form);
        expect(schema.fields[0]).toEqual(expect.objectContaining({
            name: 'field1',
            label: 'Field 1'
        }));
    });

    test('should fill a form with data', () => {
        const form = document.getElementById('form1');
        const data = { structured: { field1: 'test value' } };
        fillForm(data, form);
        expect(form.querySelector('[name="field1"]').value).toBe('test value');
    });
});
