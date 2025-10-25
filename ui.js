// ui.js

const FLOAT_ID = 'voxai-floating-mic';

function createFloatingMic() {
  if (document.getElementById(FLOAT_ID)) return;
  const el = document.createElement('div');
  el.id = FLOAT_ID;
  el.style.position = 'fixed';
  el.style.right = '18px';
  el.style.bottom = '18px';
  el.style.width = '72px';
  el.style.height = '72px';
  el.style.borderRadius = '36px';
  el.style.background = '#FFD700'; // VOX.AI yellow
  el.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.cursor = 'pointer';
  el.style.zIndex = 2147483647;
  el.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
  el.style.transform = 'scale(1)';
  el.title = 'VOX.AI — click to start/stop recording';

  // Add hover effects
  el.addEventListener('mouseenter', () => {
    if (!isRecording()) {
      el.style.transform = 'scale(1.05)';
      el.style.boxShadow = '0 12px 40px rgba(0,0,0,0.2)';
    }
  });

  el.addEventListener('mouseleave', () => {
    if (!isRecording()) {
      el.style.transform = 'scale(1)';
      el.style.boxShadow = '0 8px 30px rgba(0,0,0,0.15)';
    }
  });

  // Add click animation
  el.addEventListener('mousedown', () => {
    el.style.transform = 'scale(0.95)';
  });

  el.addEventListener('mouseup', () => {
    if (!isRecording()) {
      el.style.transform = 'scale(1.05)';
    }
  });

  // Inner structure: waveform container + central mic button
  el.innerHTML = `
    <div id="voxai-wave" style="position:absolute;inset:8px;border-radius:28px;pointer-events:none;display:flex;align-items:center;justify-content:center;">
      <div id="voxai-level" style="display:flex;gap:3px;align-items:center;justify-content:center;pointer-events:none;">
        ${Array.from({ length: 9 }).map(() => '<div class="vox-bar" style="width:3px;height:10px;background:rgba(255,255,255,0.28);border-radius:2px;transition:height 0.08s linear, background 120ms linear"></div>').join('')}
      </div>
    </div>
    <div id="voxai-button" style="position:relative;width:52px;height:52px;border-radius:26px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.15);transition:all 0.3s ease;">
      <svg id="voxai-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transition:all 0.3s ease;">
        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="#FFD700"/>
        <path d="M19 11a1 1 0 0 1-2 0 5 5 0 0 1-10 0 1 1 0 0 1-2 0 5 5 0 0 0 4 4.9V20a1 1 0 1 0 2 0v-4.1A5 5 0 0 0 19 11z" fill="#FFD700" opacity="0.6"/>
      </svg>
    </div>
    <div id="voxai-status" style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#4CAF50;display:none;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
      <div style="width:8px;height:8px;border-radius:50%;background:#fff;animation:pulse 1.5s infinite;"></div>
    </div>`;

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes recordingPulse {
      0% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(255, 107, 107, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0); }
    }
    .voxai-recording {
      animation: recordingPulse 2s infinite;
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(el);

  // cache a reference to the inner level element for real-time updates
  el._levelEl = el.querySelector('#voxai-level');

  el.addEventListener('click', async () => {
    if (isRecording() || isInitializing() || isStopping()) {
      if(isRecording()) {
        await handleStopRecording();
      }
    } else {
      await handleStartRecording();
    }
  });
}

function updateUIRecording() {
  const el = document.getElementById(FLOAT_ID);
  if (el) {
    el.dataset.recording = '1';
    el.style.background = '#ff6b6b';
    el.classList.add('voxai-recording');
    const statusEl = el.querySelector('#voxai-status');
    if (statusEl) {
      statusEl.style.display = 'flex';
    }
  }
}

function updateUIStopped() {
  const el = document.getElementById(FLOAT_ID);
  if (el) {
    delete el.dataset.recording;
    el.style.background = '#FFD700';
    el.classList.remove('voxai-recording');
    const statusEl = el.querySelector('#voxai-status');
    if (statusEl) {
      statusEl.style.display = 'none';
    }
    const levelEl = el._levelEl;
    if (levelEl) {
      levelEl.style.transform = 'scale(1)';
      levelEl.style.background = '#111';
    }
  }
}

function startAnalyseLoop(analyser) {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  const el = document.getElementById(FLOAT_ID);
  const levelEl = el && el._levelEl;

  function draw() {
    analyser.getByteTimeDomainData(data);
    // compute RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const normalized = Math.min(1, rms * 2.5); // scale to make it more responsive

    if (levelEl) {
      const scale = 0.6 + normalized * 0.8; // 0.6..1.4
      levelEl.style.transform = `scale(${scale})`;
      // color shift: low->dark, high->red
      const hue = Math.round((1 - normalized) * 120); // 120 -> green to 0 -> red
      levelEl.style.background = `hsl(${hue} 80% ${normalized > 0.4 ? 40 : 18}%)`;
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}
