/**
 * Linguaskill Cambridge University Simulator
 * Incluye: Registro de Candidato, Temporizadores por Sección, 8 Actividades del Cuaderno
 * y Exportación de Reporte de Resultados en PDF (Print-to-PDF nativo).
 */
(() => {
  'use strict';

  /* ========================================================================
     1. Estado Global y Seguridad
     ======================================================================== */
  const SECTION_DURATIONS = {
    reading: 25 * 60,   // 25 minutos
    listening: 20 * 60, // 20 minutos
    writing: 45 * 60,   // 45 minutos
    speaking: 15 * 60   // 15 minutos
  };

  const state = {
    scores: {
      readingMC: 0,
      readingOC: 0,
      readingGap: 0,
      listeningNotes: 0,
      listeningMC: 0
    },
    sectionTimers: {
      reading: { remaining: SECTION_DURATIONS.reading, intervalId: null },
      listening: { remaining: SECTION_DURATIONS.listening, intervalId: null },
      writing: { remaining: SECTION_DURATIONS.writing, intervalId: null },
      speaking: { remaining: SECTION_DURATIONS.speaking, intervalId: null }
    },
    audioPlays: { audio1: 2, audio2: 2 },
    speakingTaskTimerId: null,
    mediaRecorder: null,
    audioChunks: []
  };

  function sanitizeHTML(rawText) {
    const div = document.createElement('div');
    div.textContent = String(rawText ?? '');
    return div.innerHTML;
  }

  function normalizeAnswer(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[.,!?;:]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  function formatMMSS(totalSeconds) {
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function getTotalObjectiveScore() {
    return Object.values(state.scores).reduce((acc, val) => acc + val, 0);
  }

  function updateGlobalScore() {
    const scoreEl = document.getElementById('global-score');
    if (scoreEl) {
      scoreEl.textContent = `${getTotalObjectiveScore()} / 24 pts`;
    }
  }

  /* ========================================================================
     2. Temporizadores Independientes por Sección
     ======================================================================== */
  function initSectionTimers() {
    document.querySelectorAll('[data-timer-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.timerAction;
        const section = btn.dataset.section;
        const timerObj = state.sectionTimers[section];
        const displayEl = document.getElementById(`timer-display-${section}`);
        if (!timerObj || !displayEl) return;

        if (action === 'start') {
          if (timerObj.intervalId) return;
          timerObj.intervalId = setInterval(() => {
            if (timerObj.remaining > 0) {
              timerObj.remaining -= 1;
              displayEl.textContent = formatMMSS(timerObj.remaining);
            } else {
              clearInterval(timerObj.intervalId);
              timerObj.intervalId = null;
              displayEl.textContent = '00:00 (Fin)';
            }
          }, 1000);
        } else if (action === 'pause') {
          clearInterval(timerObj.intervalId);
          timerObj.intervalId = null;
        } else if (action === 'reset') {
          clearInterval(timerObj.intervalId);
          timerObj.intervalId = null;
          timerObj.remaining = SECTION_DURATIONS[section];
          displayEl.textContent = formatMMSS(timerObj.remaining);
        }
      });
    });
  }

  /* ========================================================================
     3. Navegación por Pestañas (WAI-ARIA Tabs + Teclado)
     ======================================================================== */
  function initTabs() {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

    function activateTab(targetTab) {
      tabs.forEach((tab) => {
        const isSelected = tab === targetTab;
        tab.setAttribute('aria-selected', String(isSelected));
        tab.setAttribute('tabindex', isSelected ? '0' : '-1');
        tab.classList.toggle('skill-nav__tab--active', isSelected);
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
     4. Módulo Reading (3 Tareas del Cuaderno Cambridge)
     ======================================================================== */
  function initReadingModule() {
    // 1A: Multiple-Choice Cloze
    const mcKey = {
      'mc-1': { ans: 'sight', tip: 'Colocación fija: "senses of sight, hearing, touch or taste".' },
      'mc-2': { ans: 'instantly', tip: '"Instantly" expresa inmediatez.' },
      'mc-3': { ans: 'response', tip: 'Colocación B2: "emotional response".' },
      'mc-4': { ans: 'exploit', tip: '"Exploit" = sacar provecho estratégico.' },
      'mc-5': { ans: 'key', tip: 'Colocación fija: "a key factor".' }
    };

    document.getElementById('form-reading-mc').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(mcKey).map(([id, rule], i) => {
        const val = e.target.elements[id].value;
        if (val === rule.ans) {
          pts += 1;
          return `<li><strong>Gap ${i + 1}:</strong> Correcto (<em>${rule.ans}</em>).</li>`;
        }
        return `<li><strong>Gap ${i + 1}:</strong> Esperada: <em>${rule.ans}</em>. ${rule.tip}</li>`;
      });
      state.scores.readingMC = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-mc', pts, 5, items);
    });

    // 1B: Open Cloze
    const ocKey = {
      'oc-1': { ans: ['there'], tip: 'Existencial plural: "there are many things".' },
      'oc-2': { ans: ['as'], tip: 'Comparativo: "just as relaxing... as".' },
      'oc-3': { ans: ['is', 'seems', 'feels'], tip: 'Verbo singular tras "whatever".' },
      'oc-4': { ans: ['that', 'which'], tip: 'Pronombre relativo para cosas.' },
      'oc-5': { ans: ['such'], tip: 'Ejemplificación: "such as walking".' }
    };

    document.getElementById('form-reading-oc').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(ocKey).map(([id, rule], i) => {
        const clean = normalizeAnswer(e.target.elements[id].value);
        if (clean.split(' ').filter(Boolean).length > 1) {
          return `<li><strong>Gap ${i + 1}:</strong> Máximo 1 palabra permitida.</li>`;
        }
        if (rule.ans.includes(clean)) {
          pts += 1;
          return `<li><strong>Gap ${i + 1}:</strong> Correcto (<em>${sanitizeHTML(clean)}</em>).</li>`;
        }
        return `<li><strong>Gap ${i + 1}:</strong> Esperada: <em>${rule.ans.join(' / ')}</em>. ${rule.tip}</li>`;
      });
      state.scores.readingOC = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-oc', pts, 5, items);
    });

    // 1C: Gapped-Text Sentences (Studying and Swimming - Lesson 8)
    const gapKey = {
      'gap-1': { ans: 'C', tip: 'Conecta "less likely to be frightened" con "always seemed fun to me".' },
      'gap-2': { ans: 'H', tip: 'Introduce el contraste sobre el esfuerzo diario ("For example, swimming practice...").' },
      'gap-3': { ans: 'D', tip: 'Pregunta retórica respondida inmediatamente con "The way I do it is...".' },
      'gap-4': { ans: 'F', tip: 'Referente "That’s something my grandmother taught me" remite a tocar el piano.' },
      'gap-5': { ans: 'B', tip: 'Amplía el tema de competiciones internacionales con el campeonato en Japón.' }
    };

    document.getElementById('form-reading-gap').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(gapKey).map(([id, rule], i) => {
        const val = e.target.elements[id].value;
        if (val === rule.ans) {
          pts += 1;
          return `<li><strong>Gap ${i + 1}:</strong> Correcto (Opción <strong>${rule.ans}</strong>).</li>`;
        }
        return `<li><strong>Gap ${i + 1}:</strong> Correcta: <strong>${rule.ans}</strong>. ${rule.tip}</li>`;
      });
      state.scores.readingGap = pts;
      updateGlobalScore();
      renderFeedback('feedback-reading-gap', pts, 5, items);
    });
  }

  /* ========================================================================
     5. Módulo Listening (2 Tareas Oficiales + Web Speech API)
     ======================================================================== */
  function initListeningModule() {
    const scripts = {
      audio1: `Hello. I'm Lucy Townsend and I'm going to talk about the sport of BASE jumping. BASE is an acronym, for the four types of objects that BASE jumpers launch from. The B stands for buildings. The A is for antennas or aerials, and the S for spans, generally bridges. The E is earth, nature. Jumping off cliffs, for example. Doing that gives me an incredible rush! I learned to sky dive before attempting BASE jumping. With BASE jumping, you go straight from standing still to falling, so you get the same feeling as when you speed down the hill of a roller coaster. Some BASE jumpers wear wingsuits. Wingsuit flyers can reach speeds of 125 miles per hour, but they have to keep adjusting their body position to maintain their speed. I leave wingsuits to the more experienced BASE jumpers. You've probably seen them doing tricks on videos. These are precision moves, and should only be attempted by those who've previously completed a considerable number of standard base jumps. When you look back at the equipment BASE jumpers used in the early days, it wasn't particularly compact, which is why the gear has changed.`,
      audio2: `Good morning Bruce. First, can you tell us what you do? Yes, until last year, I worked in a gym as a fitness instructor, showing people how to use the exercise equipment and leading exercise classes, but I am now a personal trainer, working with one person at a time. What do you like about your job? Most of all it is helping people to turn their lives around. Some of my clients have lost an incredible amount of weight or recovered from other problems. Is there anything you really dislike about it? I often have to work evenings and weekends because that is when most people prefer to exercise. And I really wish that wasn't the case. The money is not very good, even for people with good qualifications, but I am doing what I love, so I don't mind that. What kind of person do you need to be to succeed in this job? Well, a perfect powerful body isn't essential, but a passion for health and fitness is, plus great communication skills. You need an ability to make your clients feel confident, and you mustn't expect too much from them too soon.`
    };

    document.querySelectorAll('[data-audio-play]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.audioPlay;
        const statusEl = document.getElementById(`status-${key}`);
        const playsSpan = document.getElementById(`plays-left-${key}`);
        const stopBtn = document.querySelector(`[data-audio-stop="${key}"]`);

        if (!('speechSynthesis' in window)) {
          statusEl.textContent = 'Síntesis de voz no disponible en este navegador. Abre la transcripción.';
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
          btn.disabled = true;
          stopBtn.disabled = false;
          statusEl.textContent = 'Reproduciendo grabación...';
        };
        utt.onend = () => {
          stopBtn.disabled = true;
          btn.disabled = state.audioPlays[key] <= 0;
          statusEl.textContent = state.audioPlays[key] > 0
            ? 'Finalizado. Te queda 1 reproducción.'
            : 'Has completado las 2 reproducciones oficiales.';
        };
        window.speechSynthesis.speak(utt);
      });
    });

    document.querySelectorAll('[data-audio-stop]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.audioStop;
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        btn.disabled = true;
        document.querySelector(`[data-audio-play="${key}"]`).disabled = state.audioPlays[key] <= 0;
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

    // Evaluación Task 2A
    const lsNotesKey = {
      'ls-1': { ans: ['cliffs', 'cliff'], tip: '"Jumping off cliffs... gives me an incredible rush".' },
      'ls-2': { ans: ['roller coaster', 'rollercoaster'], tip: '"speed down the hill of a roller coaster".' },
      'ls-3': { ans: ['body position'], tip: '"keep adjusting their body position".' },
      'ls-4': { ans: ['precision moves'], tip: '"These are precision moves".' },
      'ls-5': { ans: ['compact'], tip: '"wasn’t particularly compact".' }
    };

    document.getElementById('form-listening-notes').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(lsNotesKey).map(([id, rule], i) => {
        const clean = normalizeAnswer(e.target.elements[id].value);
        if (clean.split(' ').filter(Boolean).length > 3) {
          return `<li><strong>Nota ${i + 1}:</strong> Excede el límite de 3 palabras.</li>`;
        }
        if (rule.ans.includes(clean)) {
          pts += 1;
          return `<li><strong>Nota ${i + 1}:</strong> Correcto (<em>${sanitizeHTML(clean)}</em>).</li>`;
        }
        return `<li><strong>Nota ${i + 1}:</strong> Esperada: <em>${rule.ans[0]}</em>. ${rule.tip}</li>`;
      });
      state.scores.listeningNotes = pts;
      updateGlobalScore();
      renderFeedback('feedback-listening-notes', pts, 5, items);
    });

    // Evaluación Task 2B
    const lmcKey = { 'lmc-1': 'B', 'lmc-2': 'C', 'lmc-3': 'A', 'lmc-4': 'B' };
    document.getElementById('form-listening-mc').addEventListener('submit', (e) => {
      e.preventDefault();
      let pts = 0;
      const items = Object.entries(lmcKey).map(([name, correct], i) => {
        const selected = e.target.elements[name]?.value;
        if (selected === correct) {
          pts += 1;
          return `<li><strong>Pregunta ${i + 1}:</strong> Correcto (${correct}).</li>`;
        }
        return `<li><strong>Pregunta ${i + 1}:</strong> Respuesta correcta: <strong>${correct}</strong>.</li>`;
      });
      state.scores.listeningMC = pts;
      updateGlobalScore();
      renderFeedback('feedback-listening-mc', pts, 4, items);
    });
  }

  /* ========================================================================
     6. Módulo Writing
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
        fb.innerHTML = `<p><strong>Conteo actual: ${wc} palabras.</strong> ${
          ok
            ? 'Extensión aprobada según criterios de Cambridge Linguaskill.'
            : `Faltan ${c.min - wc} palabras para cumplir el mínimo requerido.`
        }</p>`;
      });
    });
  }

  /* ========================================================================
     7. Módulo Speaking (3 Partes del Cuaderno + Cronómetro + Grabación)
     ======================================================================== */
  function initSpeakingModule() {
    const prompts = {
      part1: {
        talkSeconds: 60,
        html: `<p><strong>Part 1 (1 minute talk · 40s prep):</strong> Talk about your favourite room.</p>
               <ul><li>where your favourite room is</li><li>what your favourite room is like</li><li>why it is your favourite room.</li></ul>`,
        model: `"I’d like to talk about my favourite room. Firstly, the room I like best is the kitchen, which is downstairs at the back of my house... So, what is it like? Well, it has big windows with views of the garden... It’s easy to see why this is my favourite room: people say the kitchen is the heart of the home, and that is certainly true for me."`
      },
      part3: {
        talkSeconds: 60,
        html: `<p><strong>Part 3 (1 minute talk · 40s prep):</strong> Your friend Sammy wants to do volunteering work on a farm during the summer holidays to improve their English and gain experience, but is worried about the hard physical work. Give Sammy advice and recommendations.</p>`,
        model: `"Hi Sammy, thanks for telling me about your summer plans. If I were you, I’d definitely apply for the farm volunteering programme because it’s a fantastic way to practise English in a real environment. However, I reckon you should start doing some light exercise beforehand so the physical work doesn't feel overwhelming. Why don't you also check the reviews from previous volunteers?"`
      },
      part4: {
        talkSeconds: 90,
        html: `<p><strong>Part 4 (90 seconds talk · 40s prep):</strong> <em>"Instead of bringing people together, social media is pushing people apart."</em></p>
               <ul><li>Consider arguments both <strong>for</strong> and <strong>against</strong> this statement.</li><li>Reach a conclusion, providing reasons to support your final argument.</li></ul>`,
        model: `"It is often argued that social media is the best way for people to keep in touch, and there is certainly some truth in that. However, there is another side to social media which needs to be considered... What is more, comments can easily be misinterpreted. All in all, despite the problems it can cause, it is here to stay, so to my mind the most important thing is to learn how to use it properly."`
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

    function renderSelectedPrompt() {
      const data = prompts[selectEl.value];
      boxEl.innerHTML = data.html;
      modelEl.textContent = data.model;
      clockEl.textContent = '00:40';
      phaseEl.textContent = 'Fase: Listo para iniciar';
    }

    selectEl.addEventListener('change', renderSelectedPrompt);
    renderSelectedPrompt();

    function clearTaskTimer() {
      if (state.speakingTaskTimerId) {
        clearInterval(state.speakingTaskTimerId);
        state.speakingTaskTimerId = null;
      }
    }

    function runTaskCountdown(sec, label, onDone) {
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

    async function startSpeakingPhase() {
      const talkSec = prompts[selectEl.value].talkSeconds;
      prepBtn.disabled = true;
      speakBtn.disabled = true;
      stopBtn.disabled = false;

      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          state.audioChunks = [];
          state.mediaRecorder = new MediaRecorder(stream);
          state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) state.audioChunks.push(e.data);
          };
          state.mediaRecorder.onstop = () => {
            const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
            audioEl.src = URL.createObjectURL(blob);
            playbackBox.hidden = false;
            stream.getTracks().forEach((t) => t.stop());
          };
          state.mediaRecorder.start();
        } catch {
          phaseEl.textContent = `Fase: Hablando (${talkSec}s) · Sin micrófono`;
        }
      }
      runTaskCountdown(talkSec, `Fase: Grabando Respuesta (${talkSec}s)`, stopSpeakingPhase);
    }

    function stopSpeakingPhase() {
      clearTaskTimer();
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
      }
      phaseEl.textContent = 'Fase: Respuesta completada';
      prepBtn.disabled = false;
      speakBtn.disabled = false;
      stopBtn.disabled = true;
    }

    prepBtn.addEventListener('click', () => {
      prepBtn.disabled = true;
      stopBtn.disabled = false;
      runTaskCountdown(40, 'Fase: Preparación (40s)', startSpeakingPhase);
    });
    speakBtn.addEventListener('click', startSpeakingPhase);
    stopBtn.addEventListener('click', stopSpeakingPhase);
  }

  /* ========================================================================
     8. Generador de Reporte Oficial en PDF (Print-to-PDF)
     ======================================================================== */
  function estimateCEFR(totalPts) {
    if (totalPts >= 21) return 'C1 (Advanced · 180+ Linguaskill Scale)';
    if (totalPts >= 16) return 'B2 (Upper-Intermediate · 160–179 Linguaskill Scale)';
    if (totalPts >= 10) return 'B1 (Intermediate · 140–159 Linguaskill Scale)';
    return 'A2 o inferior (< 140 Linguaskill Scale · Requiere refuerzo)';
  }

  function initPDFReport() {
    const pdfBtn = document.getElementById('btn-generate-pdf');
    const alertEl = document.getElementById('candidate-alert');
    const printContainer = document.getElementById('pdf-print-report');

    pdfBtn.addEventListener('click', () => {
      const firstName = document.getElementById('candidate-firstname').value.trim();
      const lastName = document.getElementById('candidate-lastname').value.trim();
      const groupId = document.getElementById('candidate-group').value.trim();

      if (!firstName || !lastName) {
        alertEl.hidden = false;
        alertEl.textContent = 'Por favor ingresa el Nombre(s) y Apellidos del candidato antes de generar el reporte PDF.';
        document.getElementById('candidate-firstname').focus();
        return;
      }
      alertEl.hidden = true;

      const readingTotal = state.scores.readingMC + state.scores.readingOC + state.scores.readingGap;
      const listeningTotal = state.scores.listeningNotes + state.scores.listeningMC;
      const grandTotal = readingTotal + listeningTotal;

      const w1Text = document.getElementById('textarea-w1').value.trim();
      const w2Text = document.getElementById('textarea-w2').value.trim();
      const w1Words = w1Text ? w1Text.split(/\s+/).length : 0;
      const w2Words = w2Text ? w2Text.split(/\s+/).length : 0;

      const timeUsed = (secKey) => {
        const elapsed = SECTION_DURATIONS[secKey] - state.sectionTimers[secKey].remaining;
        return formatMMSS(Math.max(elapsed, 0));
      };

      const today = new Date().toLocaleDateString('es-MX', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      printContainer.innerHTML = `
        <div class="print-report__header">
          <h1>Linguaskill Cambridge Preparation — Reporte de Resultados</h1>
          <p><strong>Candidato:</strong> ${sanitizeHTML(firstName)} ${sanitizeHTML(lastName)}</p>
          ${groupId ? `<p><strong>Grupo / Matrícula:</strong> ${sanitizeHTML(groupId)}</p>` : ''}
          <p><strong>Fecha de emisión:</strong> ${sanitizeHTML(today)}</p>
        </div>

        <h2>1. Resumen de Desempeño Objetivo</h2>
        <table class="print-report__table">
          <thead>
            <tr>
              <th>Módulo / Destreza</th>
              <th>Desglose de Tareas</th>
              <th>Puntaje Obtenido</th>
              <th>Tiempo Registrado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Reading</strong></td>
              <td>Task 1A (${state.scores.readingMC}/5) · Task 1B (${state.scores.readingOC}/5) · Task 1C (${state.scores.readingGap}/5)</td>
              <td><strong>${readingTotal} / 15 pts</strong></td>
              <td>${timeUsed('reading')}</td>
            </tr>
            <tr>
              <td><strong>Listening</strong></td>
              <td>Task 2A (${state.scores.listeningNotes}/5) · Task 2B (${state.scores.listeningMC}/4)</td>
              <td><strong>${listeningTotal} / 9 pts</strong></td>
              <td>${timeUsed('listening')}</td>
            </tr>
            <tr>
              <td><strong>Writing</strong></td>
              <td>Part 1 Email (${w1Words} palabras) · Part 2 Essay (${w2Words} palabras)</td>
              <td>Evaluación por rúbrica</td>
              <td>${timeUsed('writing')}</td>
            </tr>
            <tr>
              <td><strong>Speaking</strong></td>
              <td>Tarea seleccionada: ${sanitizeHTML(document.getElementById('speaking-prompt-select').selectedOptions[0].text)}</td>
              <td>Autoevaluación auditiva</td>
              <td>${timeUsed('speaking')}</td>
            </tr>
          </tbody>
        </table>

        <p><strong>Puntaje Total Objetivo:</strong> ${grandTotal} / 24 puntos (${Math.round((grandTotal / 24) * 100)}%)</p>
        <p><strong>Estimación Orientativa MCER:</strong> ${estimateCEFR(grandTotal)}</p>

        <h2>2. Evidencias de Producción Escrita (Writing)</h2>
        <h3>Writing Part 1 — Email (${w1Words} palabras)</h3>
        <div class="print-report__writing-sample">${sanitizeHTML(w1Text || '[Sin respuesta registrada]')}</div>

        <h3>Writing Part 2 — Essay (${w2Words} palabras)</h3>
        <div class="print-report__writing-sample">${sanitizeHTML(w2Text || '[Sin respuesta registrada]')}</div>
      `;

      window.print();
    });
  }

  /* ========================================================================
     9. Utilidades de Retroalimentación y Reinicio
     ======================================================================== */
  function renderFeedback(elementId, points, maxPoints, listItems) {
    const el = document.getElementById(elementId);
    el.hidden = false;
    el.className = `feedback-box ${points === maxPoints ? 'feedback-box--success' : ''}`;
    el.innerHTML = `<p><strong>Resultado: ${points} / ${maxPoints} puntos</strong></p><ul>${listItems.join('')}</ul>`;
  }

  function initResets() {
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
          'form-listening-notes': ['listeningNotes', 'feedback-listening-notes'],
          'form-listening-mc': ['listeningMC', 'feedback-listening-mc']
        };
        if (map[formId]) {
          const [scoreKey, fbId] = map[formId];
          state.scores[scoreKey] = 0;
          document.getElementById(fbId).hidden = true;
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
    initResets();
  });
})();