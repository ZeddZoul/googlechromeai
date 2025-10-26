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
const mockMediaRecorderInstance = {
    start: jest.fn(),
    stop: jest.fn(),
    state: 'inactive',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    ondataavailable: null,
    onstop: null,
};
global.MediaRecorder = jest.fn(() => {
    mockMediaRecorderInstance.state = 'recording';
    return mockMediaRecorderInstance;
});

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

        // Reset mock MediaRecorder
        Object.assign(mockMediaRecorderInstance, {
            start: jest.fn(),
            stop: jest.fn(),
            state: 'inactive',
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            ondataavailable: null,
            onstop: null,
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

    describe('getSurroundingText', () => {
        test('should return the text of the preceding sibling', () => {
            const form = document.getElementById('form1');
            expect(getSurroundingText(form)).toBe('Some text before the form');
        });

        test('should return an empty string if there are no preceding siblings', () => {
            const form = document.getElementById('form1');
            form.previousElementSibling.remove();
            expect(getSurroundingText(form)).toBe('');
        });

        test('should return an empty string for invalid input', () => {
            expect(getSurroundingText(null)).toBe('');
            expect(getSurroundingText(undefined)).toBe('');
        });
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

    test('should orchestrate recording, processing, and form filling', async () => {
        // 1. Setup
        const postMessageSpy = jest.spyOn(window, 'postMessage');
        let onDeviceCheckListener;
        let onInpageResponseListener;

        // Mock addEventListener to capture the listeners
        jest.spyOn(window, 'addEventListener').mockImplementation((event, listener) => {
            if (event === 'message') {
                if (listener.name === 'onDeviceCheck') {
                    onDeviceCheckListener = listener;
                } else if (listener.name === 'onInpageResponse') {
                    onInpageResponseListener = listener;
                }
            }
        });

        // 2. Start Recording
        const form = document.getElementById('form1');
        const mic = document.createElement('div');
        await handleStartRecording(mic, form);
        expect(mockMediaRecorderInstance.start).toHaveBeenCalled();

        // 3. Stop Recording
        recordingState.fallbackTranscript = 'Set Field 1 to hello world';
        await handleStopRecording(mic);
        expect(mockMediaRecorderInstance.stop).toHaveBeenCalled();

        // 4. Trigger processing and simulate async flow
        const onstopPromise = mockMediaRecorderInstance.onstop();

        // Simulate the CHECK_ON_DEVICE message
        const channel = postMessageSpy.mock.calls[0][0].channel;
        onDeviceCheckListener({ data: { channel } });

        // Simulate the PROCESS_TEXT_INPAGE message and response
        const mockAiPayload = { success: true, result: { structured: { field1: 'hello world' } } };
        onInpageResponseListener({ data: { channel, payload: mockAiPayload } });

        // Wait for all async operations to complete
        await onstopPromise;

        // 5. Assertions
        expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
            voxai: 'PROCESS_TEXT_INPAGE',
            context: 'Some text before the form' // This should now pass
        }), '*');
        expect(form.querySelector('[name="field1"]').value).toBe('hello world');
        expect(recordingState.activeForm).toBeNull(); // Check that cleanup happened

        // 6. Cleanup
        postMessageSpy.mockRestore();
        window.addEventListener.mockRestore();
    });
});
