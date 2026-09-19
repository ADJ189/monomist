import type { PlayerEngine } from '../player/engine';
import {
  settingsStore,
  EQ_BAND_HZ,
  EQ_PRESETS,
  type AppSettings,
  type VisualizerStyle,
  type MotionPreference
} from '../storage/settings-store';

const VIS_STYLES: { value: VisualizerStyle; label: string }[] = [
  { value: 'bars', label: 'Bars' },
  { value: 'wave', label: 'Wave' },
  { value: 'radial', label: 'Radial' },
  { value: 'ambient', label: 'Ambient' }
];

const MOTION_OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'always', label: 'Reduced' },
  { value: 'never', label: 'Full motion' }
];

const PRESET_LABELS: Record<string, string> = {
  flat: 'Flat',
  'bass-boost': 'Bass boost',
  'treble-boost': 'Treble boost',
  vocal: 'Vocal',
  acoustic: 'Acoustic',
  electronic: 'Electronic',
  loudness: 'Loudness',
  custom: 'Custom'
};

type Tab = 'appearance' | 'equalizer' | 'playback' | 'about';

export interface SettingsPanel {
  open(): void;
  close(): void;
}

/** Mounts a single settings overlay (hidden by default) into `root` and returns open/close controls. */
export function mountSettingsPanel(root: HTMLElement, engine: PlayerEngine): SettingsPanel {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="settings-panel__header">
        <h2>Settings</h2>
        <button class="settings-close" id="settings-close" aria-label="Close settings">✕</button>
      </div>
      <div class="settings-panel__tabs" role="tablist">
        <button class="settings-tab active" data-settings-tab="appearance" role="tab">Appearance</button>
        <button class="settings-tab" data-settings-tab="equalizer" role="tab">Equalizer</button>
        <button class="settings-tab" data-settings-tab="playback" role="tab">Playback</button>
        <button class="settings-tab" data-settings-tab="about" role="tab">About</button>
      </div>
      <div class="settings-panel__body" id="settings-body"></div>
    </div>
  `;
  root.appendChild(overlay);

  const body = overlay.querySelector<HTMLDivElement>('#settings-body')!;
  let activeTab: Tab = 'appearance';

  function close(): void {
    overlay.hidden = true;
  }
  function open(): void {
    overlay.hidden = false;
    render();
  }

  overlay.querySelector('#settings-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  overlay.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.settingsTab as Tab;
      overlay.querySelectorAll('[data-settings-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
  });

  function render(): void {
    const s = settingsStore.get();
    if (activeTab === 'appearance') body.innerHTML = renderAppearance(s);
    else if (activeTab === 'equalizer') body.innerHTML = renderEqualizer(s, engine);
    else if (activeTab === 'playback') body.innerHTML = renderPlayback(s);
    else body.innerHTML = renderAbout();
    wireCurrentTab(body);
  }

  function wireCurrentTab(body: HTMLElement): void {
    if (activeTab === 'appearance') wireAppearance(body);
    else if (activeTab === 'equalizer') wireEqualizer(body);
    else if (activeTab === 'playback') wirePlayback(body);
  }

  return { open, close };
}

// ---------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------
/**
 * Renders the HTML for the Appearance settings tab.
 */
function renderAppearance(s: AppSettings): string {
  return `
    <section class="settings-section">
      <h3>Visualizer</h3>
      <div class="segmented" id="seg-visualizer">
        ${VIS_STYLES.map(
          (v) => `<button class="segmented__item ${s.visualizerStyle === v.value ? 'active' : ''}" data-value="${v.value}">${v.label}</button>`
        ).join('')}
      </div>
    </section>
    <section class="settings-section">
      <h3>Background intensity</h3>
      <div class="settings-row">
        <input type="range" id="range-intensity" min="0" max="150" step="5" value="${Math.round(s.backgroundIntensity * 100)}" />
        <span class="settings-row__value" id="val-intensity">${Math.round(s.backgroundIntensity * 100)}%</span>
      </div>
    </section>
    <section class="settings-section">
      <h3>Accent color</h3>
      <div class="segmented" id="seg-accent">
        <button class="segmented__item ${s.accentMode === 'artwork' ? 'active' : ''}" data-value="artwork">From artwork</button>
        <button class="segmented__item ${s.accentMode === 'fixed' ? 'active' : ''}" data-value="fixed">Fixed color</button>
      </div>
      <div class="settings-row" id="row-fixed-hue" ${s.accentMode !== 'fixed' ? 'hidden' : ''}>
        <input type="range" id="range-hue" min="0" max="360" step="1" value="${s.fixedHue}" />
        <span class="hue-swatch" id="hue-swatch" style="background: hsl(${s.fixedHue} 55% 55%)"></span>
      </div>
    </section>
    <section class="settings-section">
      <h3>Motion</h3>
      <div class="segmented" id="seg-motion">
        ${MOTION_OPTIONS.map(
          (m) => `<button class="segmented__item ${s.motionPreference === m.value ? 'active' : ''}" data-value="${m.value}">${m.label}</button>`
        ).join('')}
      </div>
      <p class="settings-hint">"System" follows your device's reduce-motion accessibility setting.</p>
    </section>
    <section class="settings-section">
      <label class="switch-row">
        <span>Compact layout</span>
        <input type="checkbox" id="chk-density" ${s.compactDensity ? 'checked' : ''} />
      </label>
    </section>
  `;
}

/**
 * Wires up event listeners for the Appearance settings tab.
 */
function wireAppearance(body: HTMLElement): void {
  body.querySelectorAll<HTMLButtonElement>('#seg-visualizer .segmented__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsStore.update({ visualizerStyle: btn.dataset.value as VisualizerStyle });
      body.querySelectorAll('#seg-visualizer .segmented__item').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  const intensityInput = body.querySelector<HTMLInputElement>('#range-intensity')!;
  const intensityVal = body.querySelector<HTMLSpanElement>('#val-intensity')!;
  intensityInput.addEventListener('input', () => {
    intensityVal.textContent = `${intensityInput.value}%`;
    settingsStore.update({ backgroundIntensity: Number(intensityInput.value) / 100 });
  });

  body.querySelectorAll<HTMLButtonElement>('#seg-accent .segmented__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.value as 'artwork' | 'fixed';
      settingsStore.update({ accentMode: mode });
      body.querySelectorAll('#seg-accent .segmented__item').forEach((b) => b.classList.toggle('active', b === btn));
      body.querySelector<HTMLElement>('#row-fixed-hue')!.hidden = mode !== 'fixed';
    });
  });

  const hueInput = body.querySelector<HTMLInputElement>('#range-hue');
  hueInput?.addEventListener('input', () => {
    const hue = Number(hueInput.value);
    settingsStore.update({ fixedHue: hue });
    body.querySelector<HTMLElement>('#hue-swatch')!.style.background = `hsl(${hue} 55% 55%)`;
  });

  body.querySelectorAll<HTMLButtonElement>('#seg-motion .segmented__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsStore.update({ motionPreference: btn.dataset.value as MotionPreference });
      body.querySelectorAll('#seg-motion .segmented__item').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  body.querySelector<HTMLInputElement>('#chk-density')!.addEventListener('change', (e) => {
    settingsStore.update({ compactDensity: (e.target as HTMLInputElement).checked });
  });
}

// ---------------------------------------------------------------------
// Equalizer
// ---------------------------------------------------------------------
/**
 * Renders the HTML for the Equalizer settings tab.
 */
function renderEqualizer(s: AppSettings, engine: PlayerEngine): string {
  const usingFallbackNow = !engine.analyser.supportsRealAudio;
  return `
    <section class="settings-section">
      <label class="switch-row">
        <span>Enable equalizer</span>
        <input type="checkbox" id="chk-eq-enabled" ${s.eqEnabled ? 'checked' : ''} />
      </label>
      <p class="settings-hint">
        Applies to tracks played back as direct audio. It can't reach audio inside the embedded
        YouTube player -- that plays in a separate browsing context Web Audio has no access to.
        ${usingFallbackNow ? ' The current track is using that fallback path right now.' : ''}
      </p>
    </section>
    <section class="settings-section">
      <h3>Preset</h3>
      <select id="select-eq-preset" class="settings-select">
        ${Object.keys(PRESET_LABELS)
          .map((key) => `<option value="${key}" ${s.eqPreset === key ? 'selected' : ''}>${PRESET_LABELS[key]}</option>`)
          .join('')}
      </select>
    </section>
    <section class="settings-section">
      <h3>Preamp</h3>
      <div class="settings-row">
        <input type="range" id="range-preamp" min="-12" max="12" step="1" value="${s.eqPreampDb}" />
        <span class="settings-row__value" id="val-preamp">${formatDb(s.eqPreampDb)}</span>
      </div>
    </section>
    <section class="settings-section">
      <h3>Bands</h3>
      <div class="eq-bands">
        ${EQ_BAND_HZ.map(
          (hz, i) => `
          <div class="eq-band">
            <span class="eq-band__value" id="eq-val-${i}">${formatDb(s.eqBandsDb[i] ?? 0)}</span>
            <div class="eq-band__slider">
              <input type="range" min="-12" max="12" step="1" value="${s.eqBandsDb[i] ?? 0}" data-eq-band="${i}" />
            </div>
            <span class="eq-band__freq">${formatHz(hz)}</span>
          </div>`
        ).join('')}
      </div>
    </section>
  `;
}

/**
 * Wires up event listeners for the Equalizer settings tab.
 */
function wireEqualizer(body: HTMLElement): void {
  body.querySelector<HTMLInputElement>('#chk-eq-enabled')!.addEventListener('change', (e) => {
    settingsStore.update({ eqEnabled: (e.target as HTMLInputElement).checked });
  });

  body.querySelector<HTMLSelectElement>('#select-eq-preset')!.addEventListener('change', (e) => {
    const preset = (e.target as HTMLSelectElement).value;
    if (preset === 'custom') return; // not a real target -- only ever reached by drifting a slider
    const bands = EQ_PRESETS[preset] ?? EQ_PRESETS.flat;
    settingsStore.update({ eqPreset: preset, eqBandsDb: [...bands] });
    bands.forEach((db, i) => {
      const input = body.querySelector<HTMLInputElement>(`[data-eq-band="${i}"]`);
      const label = body.querySelector<HTMLSpanElement>(`#eq-val-${i}`);
      if (input) input.value = String(db);
      if (label) label.textContent = formatDb(db);
    });
  });

  const preampInput = body.querySelector<HTMLInputElement>('#range-preamp')!;
  const preampVal = body.querySelector<HTMLSpanElement>('#val-preamp')!;
  preampInput.addEventListener('input', () => {
    preampVal.textContent = formatDb(Number(preampInput.value));
    settingsStore.update({ eqPreampDb: Number(preampInput.value) });
  });

  body.querySelectorAll<HTMLInputElement>('[data-eq-band]').forEach((input) => {
    input.addEventListener('input', () => {
      const idx = Number(input.dataset.eqBand);
      const current = [...settingsStore.get().eqBandsDb];
      current[idx] = Number(input.value);
      body.querySelector<HTMLSpanElement>(`#eq-val-${idx}`)!.textContent = formatDb(current[idx]);
      settingsStore.update({ eqBandsDb: current, eqPreset: 'custom' });
      const select = body.querySelector<HTMLSelectElement>('#select-eq-preset');
      if (select) select.value = 'custom';
    });
  });
}

/**
 * Formats a decibel value with sign and dB suffix.
 */
function formatDb(db: number): string {
  return `${db > 0 ? '+' : ''}${db}dB`;
}

/**
 * Formats a frequency in Hz, using 'k' suffix for kHz.
 */
function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

// ---------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------
/**
 * Renders the HTML for the Playback settings tab.
 */
function renderPlayback(s: AppSettings): string {
  return `
    <section class="settings-section">
      <label class="switch-row">
        <span>Remember playback speed</span>
        <input type="checkbox" id="chk-remember-speed" ${s.rememberSpeed ? 'checked' : ''} />
      </label>
      <p class="settings-hint">Keeps using your last chosen speed (0.75×-2×) for new tracks and after a reload, instead of always starting at 1×.</p>
    </section>
  `;
}

/**
 * Wires up event listeners for the Playback settings tab.
 */
function wirePlayback(body: HTMLElement): void {
  body.querySelector<HTMLInputElement>('#chk-remember-speed')!.addEventListener('change', (e) => {
    settingsStore.update({ rememberSpeed: (e.target as HTMLInputElement).checked });
  });
}

// ---------------------------------------------------------------------
// About
// ---------------------------------------------------------------------
/**
 * Renders the HTML for the About tab.
 */
function renderAbout(): string {
  return `
    <section class="settings-section">
      <h3>Monomist</h3>
      <p class="settings-hint">
        A local-first music player. This settings panel and its interaction patterns take cues
        from the open-source Metrolist player; the visualizer and ambient background continue the
        restrained, monochrome-plus-one-live-accent approach already used for the now-playing bar.
      </p>
    </section>
  `;
}
