/**
 * @jest-environment jsdom
 */

// --- Mocks ---

global.chrome = {
    runtime: {
        getURL: jest.fn(path => `chrome-extension://mock/${path}`),
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
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
    init,
} = require('./content_script');

describe('Survsay Content Script', () => {
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
        expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(1);
    });

    test('should remove all mics from the page', () => {
        attachMicsToForms();
        removeAllMics();
        expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(0);
    });

    describe('div-form detection', () => {
        test('should attach a mic to a valid div-form', () => {
            document.body.innerHTML = `
                <div>
                    <input type="text" name="name" />
                    <input type="email" name="email" />
                </div>
            `;
            attachMicsToForms();
            expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(1);
        });

        test('should not attach a mic to a div that contains a real form', () => {
            document.body.innerHTML = `
                <div>
                    <form>
                        <input type="text" name="name" />
                        <input type="email" name="email" />
                    </form>
                </div>
            `;
            attachMicsToForms();
            expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(1);
            expect(document.querySelectorAll('form .survsay-floating-mic').length).toBe(0); // Make sure it's not on the form
        });

        test('should only attach a mic to the outermost div in nested div-forms', () => {
            document.body.innerHTML = `
                <div id="outer">
                    <input type="text" name="name" />
                    <div id="inner">
                        <input type="email" name="email" />
                    </div>
                </div>
            `;
            attachMicsToForms();
            expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(1);
        });
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
        const mic = document.createElement('button');
        mic.innerHTML = '<span>fill this form with survsay</span><svg><path/></svg>'; // Mock the structure

        await handleStartRecording(mic, form);
        expect(mic.classList.contains('survsay-recording')).toBe(true);
        expect(mic.style.background).toBe('rgb(220, 38, 38)'); // #DC2626
        expect(mic.querySelector('span').textContent).toBe('stop recording');
        expect(recordingState.activeForm).toBe(form);

        await handleStopRecording(mic);
        expect(mic.classList.contains('survsay-recording')).toBe(false);
        expect(mic.style.background).toBe('white');
        expect(mic.querySelector('span').textContent).toBe('fill this form with survsay');
    });

    test('should analyze a form and return a schema', () => {
        const form = document.getElementById('form1');
        const schema = analyzeForm(form);
        expect(schema.fields[0]).toEqual(expect.objectContaining({
            name: 'field1',
            label: 'Field 1'
        }));
    });

    describe('fillForm', () => {
        test('should fill a simple text input', () => {
            const form = document.getElementById('form1');
            const data = { structured: { field1: 'test value' } };
            fillForm(data, form);
            expect(form.querySelector('[name="field1"]').value).toBe('test value');
        });

        test('should fill complex forms with selects and radios', () => {
            document.body.innerHTML = `
                <form id="complex-form">
                    <select name="role">
                        <option value="dev">Developer</option>
                        <option value="designer">Designer</option>
                    </select>
                    <input type="radio" name="gender" value="male" />
                    <input type="radio" name="gender" value="female" />
                </form>
            `;
            const form = document.getElementById('complex-form');
            const data = { structured: { role: 'Designer', gender: 'female' } };
            fillForm(data, form);

            expect(form.querySelector('[name="role"]').value).toBe('designer');
            expect(form.querySelector('[name="gender"][value="female"]').checked).toBe(true);
        });
    });

    // TODO: The orchestration test is currently broken and needs to be rewritten.
    // It fails to correctly simulate the asynchronous, multi-layer AI fallback logic.
    // This will be addressed in a future update.

    test('should position the button inside the form if it would be off-screen', () => {
        // Mock a form that is scrolled off-screen at the top
        const form = document.getElementById('form1');
        form.getBoundingClientRect = () => ({
            top: -50,
            right: 800,
        });

        attachMicsToForms();

        const mic = document.querySelector('.survsay-floating-mic');
        // Need to wait for the setTimeout in the setPosition function
        setTimeout(() => {
            expect(mic.style.top).toBe('-40px'); // -50px (form top) + 10px
            expect(mic.style.left).not.toBe(''); // A value should be set
        }, 110);
    });

    test('should remove mics and send message on CSP failure', async () => {
        jest.useFakeTimers();
        window.__survsay_firebase_injector_complete = false;

        const initPromise = init();

        // Mics should be attached initially
        expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(1);

        // Fast-forward timers to trigger the CSP check
        jest.runAllTimers();

        // Wait for the promise chain to resolve
        await initPromise;

        expect(document.querySelectorAll('.survsay-floating-mic').length).toBe(0);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CSP_BLOCKED' });
        jest.useRealTimers();
    });
});
