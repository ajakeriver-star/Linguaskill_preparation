/**
 * Linguaskill Cambridge Adaptive Simulator
 * Incluye: Motor Adaptativo CAT (B1–C2), Persistencia localStorage, Lectura Previa 45s,
 * Rúbricas Cambridge, Temporizadores por Sección y Reporte PDF.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'linguaskill_cambridge_trainer_v2';
  const SECTION_DURATIONS = {
    reading: 25 * 60,
    listening: 20 * 60,
    writing: 45 * 60,
    speaking: 15 * 60
  };

  const state = {
    scores: {
      readingMC: 0,
      readingOC: 0,
      readingGap: 0,
      readingCTM: 0,
      listeningNotes: 0,
      listeningMC: 0,
      listeningMM: 0
    },
    sectionTimers: {
      reading: { remaining: SECTION_DURATIONS.reading, intervalId: null },
      listening: { remaining: SECTION_DURATIONS.listening, intervalId: null },
      writing: { remaining: SECTION_DURATIONS.writing, intervalId: null },
      speaking: { remaining: SECTION_DURATIONS.speaking, intervalId: null }
    },
    audioPlays: { audio1: 2, audio2: 2, audio3: 2 },
    prepTimerId: null,
    speakingTaskTimerId: null,
    mediaRecorder: null,
    audioChunks: []
  };

  function sanitizeHTML(raw) {
    const div = document.createElement('div');
    div.textContent = String(raw ?? '');
    return div.innerHTML;
  }

  function normalizeAnswer(val) {
    return String(val ?? '').trim().toLowerCase().replace(/[.,!?;:]+$/g, '').replace(/\s+/g, ' ');
  }

  function formatMMSS(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function getTotalObjectiveScore() {
    return Object.values(state.scores).reduce((sum, n) => sum + n, 0);
  }

  /* ========================================================================
     1. Motor Adaptativo (CAT) & Actualización de Progreso
     ======================================================================== */
  function evaluateAdaptiveUnlocks() {
    const adaptiveEnabled = document.getElementById('adaptive-mode-toggle').checked;

    // Reading Base = 15 pts (75% = 11 pts)
    const readingBase = state.scores.readingMC + state.scores.readingOC + state.scores.readingGap;
    const unlockReadingC1 = !adaptiveEnabled || readingBase >= 11;
    document.getElementById('card-reading-c1').hidden = !unlockReadingC1;
    document.getElementById('reading-c1-lock-notice').hidden = unlockReadingC1;

    // Listening Base = 9 pts (75% = 7 pts)
    const listeningBase = state.scores.listeningNotes + state.scores.listeningMC;
    const unlockListeningC1 = !adaptiveEnabled || listeningBase >= 7;
    document.getElementById('card-listening-c1').hidden = !unlockListeningC1;
    document.getElementById('listening-c1-lock-notice').hidden = unlockListeningC1;
  }

  function updateGlobalScore() {
    const scoreEl = document.getElementById('global-score');
    if (scoreEl) {
      scoreEl.textContent = `${getTotalObjectiveScore()} / 33 pts`;
    }
    evaluateAdaptiveUnlocks();
    saveProgressToLocal();
  }

  /* ========================================================================
     2. Persistencia Automática en localStorage
     ======================================================================== */
  function saveProgressToLocal() {
    try {
      const payload = {
        candidate: {
          firstName: document.getElementById('candidate-firstname').value,
          lastName: document.getElementById('candidate-lastname').value,
          groupId: document.getElementById('candidate-group').value
        },
        adaptive: document.getElementById('adaptive-mode-toggle').checked,
        scores: state.scores,
        timers: {
          reading: state.sectionTimers.reading.remaining,
          listening: state.sectionTimers.listening.remaining,
          writing: state.sectionTimers.writing.remaining,
          speaking: state.sectionTimers.speaking.remaining
        },
        writing: {
          w1: document.getElementById('textarea-w1').value,
          w2: document.getElementById('textarea-w2').value
        },
        speakingNotes: document.getElementById('speaking-notes').value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const statusEl = document.getElementById('autosave-status');
      if (statusEl) statusEl.textContent = `Progreso guardado localmente (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`;
    } catch {
      // Silencioso si el almacenamiento privado está restringido
    }
  }

  function loadProgressFromLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.candidate) {
        document.getElementById('candidate-firstname').value = data.candidate.firstName || '';
        document.getElementById('candidate-lastname').value = data.candidate.lastName || '';
        document.getElementById('candidate-group').value = data.candidate.groupId || '';
      }
      if (typeof data.adaptive === 'boolean') {
        document.getElementById('adaptive-mode-toggle').checked = data.adaptive;
      }
      if (data.scores) {
        Object.assign(state.scores, data.scores);
      }
      if (data.timers) {
        Object.keys(SECTION_DURATIONS).forEach((sec) => {
          if (typeof data.timers[sec] === 'number') {
            state.sectionTimers[sec].remaining = data.timers[sec];
            document.getElementById(`timer-display-${sec}`).textContent = formatMMSS(data.timers[sec]);
          }
        });
      }
      if (data.writing) {
        document.getElementById('textarea-w1').value = data.writing.w1 || '';
        document.getElementById('textarea-w2').value = data.writing.w2 || '';
        document.getElementById('textarea-w1').dispatchEvent(new Event('input'));
        document.getElementById('textarea-w2').dispatchEvent(new Event('input'));
      }
      if (data.speakingNotes) {
        document.getElementById('speaking-notes').value = data.speakingNotes;
      }
    } catch {
      // Ignorar datos corruptos
    }
  }

  /* ========================================================================
     3. Temporizadores Independientes por Sección con Alertas Visuales
     ======================================================================== */
  function initSectionTimers() {
    document.querySelectorAll('[data-timer-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { timerAction: action, section } = btn.dataset;
        const timerObj = state.sectionTimers[section];
        const displayEl = document.getElementById(`timer-display-${section}`);
        const boxEl = document.getElementById(`timer-box-${section}`);

        if (action === 'start') {
          if (timerObj.intervalId) return;
          timerObj.intervalId = setInterval(() => {
            if (timerObj.remaining > 0) {
              timerObj.remaining -= 1;
              const isLow = timerObj.remaining <= 120;
              boxEl.classList.toggle('section-timer--warning', isLow);
              displayEl.textContent = isLow
                ? `⚠ ${formatMMSS(timerObj.remaining)}`
                : formatMMSS(timerObj.remaining);
              if (timerObj.remaining % 15 === 0) saveProgressToLocal();
            } else {
              clearInterval(timerObj.intervalId);
              timerObj.intervalId = null;
              displayEl.textContent = '00:00 (Tiempo agotado)';
            }
          }, 1000);
        } else if (action === 'pause') {
          clearInterval(timerObj.intervalId);
          timerObj.intervalId = null;
          saveProgressToLocal();
        } else if (action === 'reset') {
          clearInterval(timerObj.intervalId);
          timerObj.intervalId = null;
          timerObj.remaining = SECTION_DURATIONS[section];
          boxEl.classList.remove('section-timer--warning');
          displayEl.textContent = formatMMSS(timerObj.remaining);
          saveProgressToLocal();
        }
      });
    });
  }

  /* ========================================================================
     4. Navegación por Pestañas (WAI-ARIA Tabs + Teclado)
     ======================================================================== */
  function initTabs() {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

    function activateTab(targetTab) {
      tabs.forEach((tab) => {
        const selected = tab === targetTab;
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('tabindex', selected ? '0' : '-1');
        tab.classList.toggle('skill-nav__tab--active', selected);
      });
      panels.forEach((panel) => {
        panel.hidden = panel.id !== targetTab.getAttribute('aria-controls');
      });
    }

    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        if (next !== null) {
          e.preventDefault();
          tabs[next].focus();
          activateTab(tabs[next]);
        }
      });
    });
  }

  /* ========================================================================
     5. Módulo Reading (4 Tareas: B1–C2)
     ======================================================================== */
  function initReadingModule() {
    const mcKey = {
      'mc-1': { ans: 'sight', tip: 'Colocación fija: "senses of sight, hearing, touch or taste".' },
      'mc-2': { ans: 'instantly', tip: '"Instantly" indica inmediatez.' },
      'mc-3': { ans: 'response', tip: 'Colocación académica: "emotional response".' },
      'mc-4': { ans: 'exploit', tip: '"Exploit" = aprovechar comercialmente.' },
      'mc-5': { ans: 'key', tip: 'Colocación B2: "a key factor".' }
    };

    document.getElementById('form-reading-mc').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(mcKey).map(([id, r], i) => {
        if (e.target.elements[id].value === r.ans) {
          pts += 1;
          return `<li><strong>Gap ${i + 1}:</strong> Correcto (<em>${r.ans}</em>).</li>`;
        }
        return `<li><strong>Gap ${i + 1}:</strong> Esperada: <em>${r.ans}</em>. ${r.tip}</li>`;
      });
      state.scores.readingMC = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-mc', pts, 5, items);
    });

    const ocKey = {
      'oc-1': { ans: ['there'], tip: 'Existencial plural: "there are many things".' },
      'oc-2': { ans: ['as'], tip: 'Comparativo de igualdad: "just as relaxing... as".' },
      'oc-3': { ans: ['is', 'seems', 'feels'], tip: 'Verbo singular tras "whatever".' },
      'oc-4': { ans: ['that', 'which'], tip: 'Pronombre relativo para objetos.' },
      'oc-5': { ans: ['such'], tip: 'Conector de ejemplificación: "such as".' }
    };

    document.getElementById('form-reading-oc').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(ocKey).map(([id, r], i) => {
        const clean = normalizeAnswer(e.target.elements[id].value);
        if (clean.split(' ').filter(Boolean).length > 1) return `<li><strong>Gap ${i + 1}:</strong> Máximo 1 palabra.</li>`;
        if (r.ans.includes(clean)) {
          pts += 1;
          return `<li><strong>Gap ${i + 1}:</strong> Correcto (<em>${sanitizeHTML(clean)}</em>).</li>`;
        }
        return `<li><strong>Gap ${i + 1}:</strong> Esperada: <em>${r.ans.join(' / ')}</em>. ${r.tip}</li>`;
      });
      state.scores.readingOC = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-oc', pts, 5, items);
    });

    const gapKey = {
      'gap-1': { ans: 'C', tip: 'Conecta la ausencia de miedo con verlo como un juego.' },
      'gap-2': { ans: 'H', tip: 'Introduce el esfuerzo detrás de ganar.' },
      'gap-3': { ans: 'D', tip: 'Pregunta respondida con "The way I do it is...".' },
      'gap-4': { ans: 'F', tip: 'Conecta "tocar el piano" con "taught me to do".' },
      'gap-5': { ans: 'B', tip: 'Amplía las competiciones hacia Japón.' }
    };

    document.getElementById('form-reading-gap').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(gapKey).map(([id, r], i) => {
        if (e.target.elements[id].value === r.ans) {
          pts += 1;
          return `<li><strong>Gap ${i + 1}:</strong> Correcto (${r.ans}).</li>`;
        }
        return `<li><strong>Gap ${i + 1}:</strong> Correcta: <strong>${r.ans}</strong>. ${r.tip}</li>`;
      });
      state.scores.readingGap = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-gap', pts, 5, items);
    });

    // Task 1D: Cross-Text Matching C1–C2
    const ctmKey = {
      'ctm-1': { ans: 'D', tip: 'Reviewer D lo llama "exceptional young actor" y dice "difficult to imagine anyone else".' },
      'ctm-2': { ans: 'B', tip: 'Reviewer B afirma: "it really is a film just for that age group".' },
      'ctm-3': { ans: 'B', tip: 'Reviewer A elogia el final ("wondrous finale"), mientras B dice "left me wanting more".' },
      'ctm-4': { ans: 'A', tip: 'Reviewer A señala "cliched dialogue and the wires keeping the balloon afloat".' }
    };

    document.getElementById('form-reading-ctm').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(ctmKey).map(([id, r], i) => {
        if (e.target.elements[id].value === r.ans) {
          pts += 1;
          return `<li><strong>Pregunta ${i + 1}:</strong> Correcto (Reviewer ${r.ans}).</li>`;
        }
        return `<li><strong>Pregunta ${i + 1}:</strong> Respuesta correcta: <strong>Reviewer ${r.ans}</strong>. ${r.tip}</li>`;
      });
      state.scores.readingCTM = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-ctm', pts, 4, items);
    });
  }

  /* ========================================================================
     6. Módulo Listening (3 Tareas + 45s Lectura Previa + Web Speech API)
     ======================================================================== */
  function initListeningModule() {
    const scripts = {
      audio1: `Hello. I'm Lucy Townsend and I'm going to talk about the sport of BASE jumping. BASE is an acronym, for the four types of objects that BASE jumpers launch from: buildings, antennas, spans, and earth—jumping off cliffs, for example. Doing that gives me an incredible rush! With BASE jumping, you go straight from standing still to falling, so you get the same feeling as when you speed down the hill of a roller coaster. Wingsuit flyers have to keep adjusting their body position to maintain their speed. More experienced jumpers do precision moves, gliding in close proximity to structures. In the early days, equipment wasn't particularly compact, which is why the gear has changed.`,
      audio2: `Good morning Bruce. Until last year I worked as a fitness instructor leading classes, but now I am a personal trainer working with one person at a time. The big reward is helping people turn their lives around. I dislike working evenings and weekends, though I don't mind the low money because I love my job. To succeed, a passion for health is essential, plus great communication skills and not expecting too much from clients too soon.`,
      audio3: `Speaker 1: Studying literature was the cornerstone of everything I did later. Most importantly, analysing complex novels gave me genuine insight into people with vastly different experiences from my own.
               Speaker 2: Before my degree, I used to unquestioningly admire famous authors. The biggest takeaway from the course was developing the self-belief to question established writers' work critically.
               Speaker 3: Learning how to structure essays and get my message across concisely has stood me in good stead in my management career. Combining complex arguments clearly was the single most valuable skill.
               Speaker 4: In journalism, an emotional response is not required. Literature trained me in detached observation—removing personal bias so my approach became completely objective.
               Speaker 5: Great texts rarely state everything explicitly. Above all, my seminars taught me how to read between the lines and detect what was hidden beneath the surface.`
    };

    function playTrack(key) {
      const statusEl = document.getElementById(`status-${key}`);
      const playsSpan = document.getElementById(`plays-left-${key}`);
      const playBtn = document.querySelector(`[data-audio-play="${key}"]`);
      const prepBtn = document.querySelector(`[data-audio-prep="${key}"]`);
      const stopBtn = document.querySelector(`[data-audio-stop="${key}"]`);

      if (!('speechSynthesis' in window)) {
        statusEl.textContent = 'Síntesis de voz no disponible. Abre la transcripción.';
        return;
      }
      if (state.audioPlays[key] <= 0) return;

      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(scripts[key]);
      utt.lang = 'en-GB';
      utt.rate = 0.95;

      utt.onstart = () => {
        state.audioPlays[key] -= 1;
        playsSpan.textContent = String(state.audioPlays[key]);
        playBtn.disabled = true;
        prepBtn.disabled = true;
        stopBtn.disabled = false;
        statusEl.textContent = 'Reproduciendo pista de audio...';
      };
      utt.onend = () => {
        stopBtn.disabled = true;
        const hasLeft = state.audioPlays[key] > 0;
        playBtn.disabled = !hasLeft;
        prepBtn.disabled = !hasLeft;
        statusEl.textContent = hasLeft ? 'Finalizado. Queda 1 reproducción.' : 'Has completado las 2 reproducciones oficiales.';
      };
      window.speechSynthesis.speak(utt);
    }

    document.querySelectorAll('[data-audio-prep]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.audioPrep;
        if (state.audioPlays[key] <= 0) return;
        clearInterval(state.prepTimerId);
        let sec = 45;
        const statusEl = document.getElementById(`status-${key}`);
        btn.disabled = true;
        statusEl.textContent = `Tiempo de lectura previa: ${sec}s antes de iniciar el audio...`;

        state.prepTimerId = setInterval(() => {
          sec -= 1;
          statusEl.textContent = `Tiempo de lectura previa: ${sec}s antes de iniciar el audio...`;
          if (sec <= 0) {
            clearInterval(state.prepTimerId);
            playTrack(key);
          }
        }, 1000);
      });
    });

    document.querySelectorAll('[data-audio-play]').forEach((btn) => {
      btn.addEventListener('click', () => {
        clearInterval(state.prepTimerId);
        playTrack(btn.dataset.audioPlay);
      });
    });

    document.querySelectorAll('[data-audio-stop]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.audioStop;
        clearInterval(state.prepTimerId);
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        btn.disabled = true;
        const hasLeft = state.audioPlays[key] > 0;
        document.querySelector(`[data-audio-play="${key}"]`).disabled = !hasLeft;
        document.querySelector(`[data-audio-prep="${key}"]`).disabled = !hasLeft;
      });
    });

    document.querySelectorAll('[data-toggle-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.toggleTarget);
        const show = target.hidden;
        target.hidden = !show;
        target.open = show;
        btn.setAttribute('aria-expanded', String(show));
      });
    });

    const lsNotesKey = {
      'ls-1': { ans: ['cliffs', 'cliff'], tip: '"Jumping off cliffs"' },
      'ls-2': { ans: ['roller coaster', 'rollercoaster'], tip: '"roller coaster"' },
      'ls-3': { ans: ['body position'], tip: '"body position"' },
      'ls-4': { ans: ['precision moves'], tip: '"precision moves"' },
      'ls-5': { ans: ['compact'], tip: '"compact"' }
    };

    document.getElementById('form-listening-notes').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(lsNotesKey).map(([id, r], i) => {
        const clean = normalizeAnswer(e.target.elements[id].value);
        if (clean.split(' ').filter(Boolean).length > 3) return `<li><strong>Nota ${i + 1}:</strong> Máximo 3 palabras.</li>`;
        if (r.ans.includes(clean)) {
          pts += 1;
          return `<li><strong>Nota ${i + 1}:</strong> Correcto (<em>${sanitizeHTML(clean)}</em>).</li>`;
        }
        return `<li><strong>Nota ${i + 1}:</strong> Esperada: <em>${r.ans[0]}</em> (${r.tip}).</li>`;
      });
      state.scores.listeningNotes = pts;
      updateGlobalScore();
      renderFeedback('feedback-listening-notes', pts, 5, items);
    });

    const lmcKey = { 'lmc-1': 'B', 'lmc-2': 'C', 'lmc-3': 'A', 'lmc-4': 'B' };
    document.getElementById('form-listening-mc').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(lmcKey).map(([name, correct], i) => {
        if (e.target.elements[name]?.value === correct) {
          pts += 1;
          return `<li><strong>Pregunta ${i + 1}:</strong> Correcto (${correct}).</li>`;
        }
        return `<li><strong>Pregunta ${i + 1}:</strong> Correcta: <strong>${correct}</strong>.</li>`;
      });
      state.scores.listeningMC = pts;
      updateGlobalScore();
      renderFeedback('feedback-listening-mc', pts, 4, items);
    });

    // Task 2C: Multi-Matching C1–C2
    const mmKey = {
      'mm-1': { ans: 'H', tip: 'Paráfrasis: "insight into people with vastly different experiences" = H.' },
      'mm-2': { ans: 'D', tip: 'Paráfrasis: "question established writers\' work critically" = D.' },
      'mm-3': { ans: 'C', tip: 'Paráfrasis: "Combining complex arguments clearly" = C.' },
      'mm-4': { ans: 'F', tip: 'Paráfrasis: "detached observation... completely objective" = F.' },
      'mm-5': { ans: 'A', tip: 'Paráfrasis: "read between the lines" = A.' }
    };

    document.getElementById('form-listening-mm').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(mmKey).map(([id, r], i) => {
        if (e.target.elements[id].value === r.ans) {
          pts += 1;
          return `<li><strong>Speaker ${i + 1}:</strong> Correcto (${r.ans}).</li>`;
        }
        return `<li><strong>Speaker ${i + 1}:</strong> Correcta: <strong>${r.ans}</strong>. ${r.tip}</li>`;
      });
      state.scores.listeningMM = pts;
      updateGlobalScore();
      renderFeedback('feedback-listening-mm', pts, 5, items);
    });
  }

  /* ========================================================================
     7. Módulo Writing
     ======================================================================== */
  function initWritingModule() {
    document.querySelectorAll('[data-insert-target]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const ta = document.getElementById(chip.dataset.insertTarget);
        const phrase = chip.dataset.phrase;
        const start = ta.selectionStart;
        ta.value = ta.value.slice(0, start) + phrase + ta.value.slice(ta.selectionEnd);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + phrase.length;
        ta.dispatchEvent(new Event('input'));
      });
    });

    const configs = [
      { id: 'w1', ta: 'textarea-w1', count: 'word-count-w1', fb: 'feedback-w1', min: 50 },
      { id: 'w2', ta: 'textarea-w2', count: 'word-count-w2', fb: 'feedback-w2', min: 180 }
    ];

    configs.forEach((c) => {
      const ta = document.getElementById(c.ta);
      const out = document.getElementById(c.count);
      ta.addEventListener('input', () => {
        const wc = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
        out.textContent = `Palabras: ${wc} / ${c.min} mín.`;
        saveProgressToLocal();
      });
    });

    document.querySelectorAll('[data-eval-writing]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = configs.find((item) => item.id === btn.dataset.evalWriting);
        const text = document.getElementById(c.ta).value.trim();
        const wc = text ? text.split(/\s+/).length : 0;
        const fb = document.getElementById(c.fb);
        const ok = wc >= c.min;

        fb.hidden = false;
        fb.className = `feedback-box ${ok ? 'feedback-box--success' : 'feedback-box--error'}`;
        fb.innerHTML = `<p><strong>Conteo: ${wc} palabras.</strong> ${
          ok ? 'Extensión aprobada según criterios de Cambridge.' : `Faltan ${c.min - wc} palabras para alcanzar el mínimo.`
        }</p>`;
      });
    });
  }

  /* ========================================================================
     8. Módulo Speaking
     ======================================================================== */
  function initSpeakingModule() {
    const prompts = {
      part1: {
        talkSeconds: 60,
        html: `<p><strong>Part 1 (1 min talk · 40s prep):</strong> Talk about your favourite room (where it is, what it is like, and why it is your favourite).</p>`,
        model: `"I’d like to talk about my favourite room. Firstly, the room I like best is the kitchen... So, what is it like? It has big windows with views of the garden... It’s easy to see why this is my favourite room: it is the heart of the home."`
      },
      part3: {
        talkSeconds: 60,
        html: `<p><strong>Part 3 (1 min talk · 40s prep):</strong> Your friend Sammy wants to volunteer on a farm this summer to practise English, but worries about hard physical work. Give advice and recommendations.</p>`,
        model: `"Hi Sammy. If I were you, I’d definitely apply because it’s a great way to practise English. However, I reckon you should start doing light exercise beforehand so the physical work feels manageable."`
      },
      part4: {
        talkSeconds: 90,
        html: `<p><strong>Part 4 (90s talk · 40s prep):</strong> <em>"Instead of bringing people together, social media is pushing people apart."</em> Consider arguments both for and against, and reach a conclusion.</p>`,
        model: `"It is often argued that social media is the best way to keep in touch, and there is certainly some truth in that. However, comments can easily be misinterpreted. All in all, despite the problems it can cause, to my mind the most important thing is to use it properly."`
      }
    };

    const selectEl = document.getElementById('speaking-prompt-select');
    const boxEl = document.getElementById('speaking-prompt-box');
    const modelEl = document.getElementById('speaking-model-text');
    const phaseEl = document.getElementById('task-timer-phase');
    const clockEl = document.getElementById('task-timer-clock');
    const prepBtn = document.getElementById('btn-start-prep');
    const speakBtn = document.getElementById('btn-start-speak');
    const stopBtn = document.getElementById('btn-stop-speak');
    const playbackBox = document.getElementById('audio-playback-container');
    const audioEl = document.getElementById('recorded-audio');

    function renderPrompt() {
      const data = prompts[selectEl.value];
      boxEl.innerHTML = data.html;
      modelEl.textContent = data.model;
      clockEl.textContent = '00:40';
      phaseEl.textContent = 'Fase: Listo para iniciar';
    }
    selectEl.addEventListener('change', renderPrompt);
    renderPrompt();

    function clearTaskTimer() {
      if (state.speakingTaskTimerId) {
        clearInterval(state.speakingTaskTimerId);
        state.speakingTaskTimerId = null;
      }
    }

    function countdown(sec, label, onDone) {
      clearTaskTimer();
      let rem = sec;
      phaseEl.textContent = label;
      clockEl.textContent = formatMMSS(rem);
      state.speakingTaskTimerId = setInterval(() => {
        rem -= 1;
        clockEl.textContent = formatMMSS(Math.max(rem, 0));
        if (rem <= 0) {
          clearTaskTimer();
          if (onDone) onDone();
        }
      }, 1000);
    }

    async function startSpeak() {
      const talkSec = prompts[selectEl.value].talkSeconds;
      prepBtn.disabled = true;
      speakBtn.disabled = true;
      stopBtn.disabled = false;

      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          state.audioChunks = [];
          state.mediaRecorder = new MediaRecorder(stream);
          state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.audioChunks.push(e.data); };
          state.mediaRecorder.onstop = () => {
            audioEl.src = URL.createObjectURL(new Blob(state.audioChunks, { type: 'audio/webm' }));
            playbackBox.hidden = false;
            stream.getTracks().forEach((t) => t.stop());
          };
          state.mediaRecorder.start();
        } catch {
          phaseEl.textContent = `Fase: Hablando (${talkSec}s) · Sin micrófono`;
        }
      }
      countdown(talkSec, `Fase: Grabando Respuesta (${talkSec}s)`, stopSpeak);
    }

    function stopSpeak() {
      clearTaskTimer();
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
      phaseEl.textContent = 'Fase: Intervención finalizada';
      prepBtn.disabled = false;
      speakBtn.disabled = false;
      stopBtn.disabled = true;
    }

    prepBtn.addEventListener('click', () => {
      prepBtn.disabled = true;
      stopBtn.disabled = false;
      countdown(40, 'Fase: Preparación (40s)', startSpeak);
    });
    speakBtn.addEventListener('click', startSpeak);
    stopBtn.addEventListener('click', stopSpeak);
  }

  /* ========================================================================
     9. Generador de Reporte Oficial en PDF
     ======================================================================== */
  function estimateCEFR(totalPts) {
    if (totalPts >= 28) return 'C1 / C1+ (Advanced · 180+ Linguaskill Scale)';
    if (totalPts >= 21) return 'B2 (Upper-Intermediate · 160–179 Linguaskill Scale)';
    if (totalPts >= 13) return 'B1 (Intermediate · 140–159 Linguaskill Scale)';
    return 'A2 o inferior (< 140 Linguaskill Scale)';
  }

  function initPDFReport() {
    document.getElementById('btn-generate-pdf').addEventListener('click', () => {
      const firstName = document.getElementById('candidate-firstname').value.trim();
      const lastName = document.getElementById('candidate-lastname').value.trim();
      const groupId = document.getElementById('candidate-group').value.trim();
      const alertEl = document.getElementById('candidate-alert');

      if (!firstName || !lastName) {
        alertEl.hidden = false;
        alertEl.textContent = 'Por favor ingresa el Nombre(s) y Apellidos del candidato antes de exportar el PDF.';
        document.getElementById('candidate-firstname').focus();
        return;
      }
      alertEl.hidden = true;

      const rTotal = state.scores.readingMC + state.scores.readingOC + state.scores.readingGap + state.scores.readingCTM;
      const lTotal = state.scores.listeningNotes + state.scores.listeningMC + state.scores.listeningMM;
      const grandTotal = rTotal + lTotal;

      const wRubricCount = document.querySelectorAll('input[name="w-rubric"]:checked').length;
      const sRubricCount = document.querySelectorAll('input[name="s-rubric"]:checked').length;

      const w1Text = document.getElementById('textarea-w1').value.trim();
      const w2Text = document.getElementById('textarea-w2').value.trim();
      const w1Words = w1Text ? w1Text.split(/\s+/).length : 0;
      const w2Words = w2Text ? w2Text.split(/\s+/).length : 0;

      const elapsed = (secKey) => formatMMSS(Math.max(SECTION_DURATIONS[secKey] - state.sectionTimers[secKey].remaining, 0));
      const now = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      const reportEl = document.getElementById('pdf-print-report');
      reportEl.innerHTML = `
        <div class="print-report__header">
          <h1>Linguaskill Cambridge Preparation — Reporte Oficial de Resultados</h1>
          <p><strong>Candidato:</strong> ${sanitizeHTML(firstName)} ${sanitizeHTML(lastName)}</p>
          ${groupId ? `<p><strong>Grupo / Matrícula:</strong> ${sanitizeHTML(groupId)}</p>` : ''}
          <p><strong>Fecha de emisión:</strong> ${sanitizeHTML(now)}</p>
        </div>
        <h2>1. Resultados por Destreza</h2>
        <table class="print-report__table">
          <thead>
            <tr><th>Módulo</th><th>Desglose</th><th>Resultado</th><th>Tiempo Invertido</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Reading</strong></td>
              <td>1A (${state.scores.readingMC}/5) · 1B (${state.scores.readingOC}/5) · 1C (${state.scores.readingGap}/5) · 1D C1 (${state.scores.readingCTM}/4)</td>
              <td><strong>${rTotal} / 19 pts</strong></td>
              <td>${elapsed('reading')}</td>
            </tr>
            <tr>
              <td><strong>Listening</strong></td>
              <td>2A (${state.scores.listeningNotes}/5) · 2B (${state.scores.listeningMC}/4) · 2C C1 (${state.scores.listeningMM}/5)</td>
              <td><strong>${lTotal} / 14 pts</strong></td>
              <td>${elapsed('listening')}</td>
            </tr>
            <tr>
              <td><strong>Writing</strong></td>
              <td>Part 1 (${w1Words} palabras) · Part 2 (${w2Words} palabras)</td>
              <td>Rúbrica: ${wRubricCount} / 4 criterios</td>
              <td>${elapsed('writing')}</td>
            </tr>
            <tr>
              <td><strong>Speaking</strong></td>
              <td>${sanitizeHTML(document.getElementById('speaking-prompt-select').selectedOptions[0].text)}</td>
              <td>Rúbrica: ${sRubricCount} / 4 criterios</td>
              <td>${elapsed('speaking')}</td>
            </tr>
          </tbody>
        </table>
        <p><strong>Puntaje Total Objetivo:</strong> ${grandTotal} / 33 pts (${Math.round((grandTotal / 33) * 100)}%)</p>
        <p><strong>Banda Estimada MCER:</strong> ${estimateCEFR(grandTotal)}</p>
        <h2>2. Portafolio de Producción Escrita</h2>
        <h3>Writing Part 1 — Email (${w1Words} palabras)</h3>
        <div class="print-report__writing-sample">${sanitizeHTML(w1Text || '[Sin respuesta]')}</div>
        <h3>Writing Part 2 — Essay (${w2Words} palabras)</h3>
        <div class="print-report__writing-sample">${sanitizeHTML(w2Text || '[Sin respuesta]')}</div>
      `;

      window.print();
    });
  }

  /* ========================================================================
     10. Utilidades Generales e Inicialización
     ======================================================================== */
  function renderFeedback(id, pts, max, listItems) {
    const el = document.getElementById(id);
    el.hidden = false;
    el.className = `feedback-box ${pts === max ? 'feedback-box--success' : ''}`;
    el.innerHTML = `<p><strong>Resultado: ${pts} / ${max} puntos</strong></p><ul>${listItems.join('')}</ul>`;
  }

  function initResetsAndEvents() {
    ['candidate-firstname', 'candidate-lastname', 'candidate-group', 'speaking-notes'].forEach((id) => {
      document.getElementById(id).addEventListener('input', saveProgressToLocal);
    });
    document.getElementById('adaptive-mode-toggle').addEventListener('change', updateGlobalScore);

    document.getElementById('btn-clear-storage').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    document.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const formId = btn.dataset.reset;
        const form = document.getElementById(formId);
        if (!form) return;
        form.reset();
        const map = {
          'form-reading-mc': ['readingMC', 'feedback-reading-mc'],
          'form-reading-oc': ['readingOC', 'feedback-reading-oc'],
          'form-reading-gap': ['readingGap', 'feedback-reading-gap'],
          'form-reading-ctm': ['readingCTM', 'feedback-reading-ctm'],
          'form-listening-notes': ['listeningNotes', 'feedback-listening-notes'],
          'form-listening-mc': ['listeningMC', 'feedback-listening-mc'],
          'form-listening-mm': ['listeningMM', 'feedback-listening-mm']
        };
        if (map[formId]) {
          const [key, fb] = map[formId];
          state.scores[key] = 0;
          document.getElementById(fb).hidden = true;
        }
        updateGlobalScore();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSectionTimers();
    initReadingModule();
    initListeningModule();
    initWritingModule();
    initSpeakingModule();
    initPDFReport();
    initResetsAndEvents();
    loadProgressFromLocal();
    updateGlobalScore();
  });
})();
