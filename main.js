// ==UserScript==
// @name         sparx-bot
// @namespace    https://github.com/xfwmk/sparx-bot/
// @version      1
// @description  Sparx Maths bot
// @match        https://maths.sparx-learning.com/student/*
// @connect      api.groq.com
// @copyright    xfwmk - opel - kian
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const GROQ_API_KEY = 'YOUR_GROQ_API_KEY';
  const MODEL = 'openai/gpt-oss-20b';
  const REQUEST_TIMEOUT_MS = 45000;
  const POLL_MS = 350;
  const DEBUG = true;

  let busy = false;
  let cancelled = false;
  let panel;
  let statusNode;
  let resultNode;

  const log = (...args) => {
    if (DEBUG) console.log('[Sparx study helper]', ...args);
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 &&
      s.display !== 'none' && s.visibility !== 'hidden';
  };

  const clean = value => String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  function setStatus(message, isError = false) {
    if (statusNode) {
      statusNode.textContent = message;
      statusNode.style.color = isError ? '#b42318' : '#174ea6';
    }
    log(message);
  }

  function validateKey() {
    return typeof GROQ_API_KEY === 'string' &&
      GROQ_API_KEY.trim().length > 20 &&
      !/YOUR_GROQ_API_KEY|GROQ_API_KEY|PASTE_YOUR/i.test(GROQ_API_KEY);
  }

  function requestGroq(messages) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      const timer = setTimeout(() => {
        finish(reject, new Error(
          'Groq request timed out. Check your connection and try again.'
        ));
      }, REQUEST_TIMEOUT_MS);

      try {
        GM_xmlhttpRequest({
          method: 'POST',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          data: JSON.stringify({
            model: MODEL,
            messages,
            temperature: 0,
            max_tokens: 1200
          }),

          onload(response) {
            if (response.status < 200 || response.status >= 300) {
              let detail = response.responseText || 'No error details returned.';
              try {
                const parsed = JSON.parse(detail);
                detail = parsed?.error?.message || detail;
              } catch (_) {}

              finish(reject, new Error(
                `Groq HTTP ${response.status}: ${detail}`
              ));
              return;
            }

            try {
              const payload = JSON.parse(response.responseText);
              const content = payload?.choices?.[0]?.message?.content;

              if (typeof content !== 'string' || !content.trim()) {
                throw new Error('Groq returned an empty response.');
              }

              finish(resolve, content.trim());
            } catch (error) {
              finish(reject, new Error(
                `Could not read Groq response: ${error.message}`
              ));
            }
          },

          onerror() {
            finish(reject, new Error(
              'Could not connect to Groq. Check network and userscript permissions.'
            ));
          },

          ontimeout() {
            finish(reject, new Error('Groq request timed out.'));
          }
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function parseJsonResponse(raw) {
    const text = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      return JSON.parse(text);
    } catch (_) {}

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {}
    }

    throw new Error(
      `The model did not return valid JSON: ${raw.slice(0, 300)}`
    );
  }

  function findQuestionContainer() {
    const selectors = [
      '[data-testid*="question" i]',
      '[aria-label*="question" i]',
      '[class*="question-content" i]',
      '[class*="question-container" i]',
      '[class*="question" i]'
    ];

    for (const selector of selectors) {
      const matches = [...document.querySelectorAll(selector)]
        .filter(visible)
        .map(el => ({ el, text: clean(el.innerText) }))
        .filter(x => x.text.length >= 15 && x.text.length < 5000)
        .sort((a, b) => a.text.length - b.text.length);

      if (matches.length) return matches[0].el;
    }

    return document.querySelector('[role="main"]') ||
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.body;
  }

  function readQuestion() {
    const container = findQuestionContainer();

    if (!container) {
      throw new Error('Could not locate question content.');
    }

    const clone = container.cloneNode(true);

    clone.querySelectorAll(
      'button, input, textarea, select, nav, footer, header, ' +
      '[aria-hidden="true"], #sparx-study-helper'
    ).forEach(el => el.remove());

    const text = clean(clone.innerText || clone.textContent);

    if (text.length < 8) {
      throw new Error(
        'Question text is too short. Check the page layout.'
      );
    }

    const images = [...container.querySelectorAll('img')]
      .filter(visible)
      .map(img => ({
        alt: clean(img.alt),
        src: img.currentSrc || img.src || ''
      }));

    return {
      text: text.slice(0, 10000),
      images
    };
  }

  function getVisibleAnswerInputs() {
    return [
      ...document.querySelectorAll(
        'input:not([type="hidden"]):not([type="button"]):' +
        ':not([type="submit"]):not([type="checkbox"]):' +
        ':not([type="radio"]), textarea'
      )
    ]
      .filter(visible)
      .filter(el =>
        !panel?.contains(el) &&
        !el.disabled &&
        el.type !== 'search'
      );
  }

  function getChoiceGroups() {
    const radios = [
      ...document.querySelectorAll('input[type="radio"]')
    ].filter(visible);

    if (radios.length) {
      return radios
        .map(input =>
          input.closest('label') ||
          input.closest('[role="radio"]') ||
          input.parentElement ||
          input
        )
        .filter((el, i, arr) =>
          arr.indexOf(el) === i && visible(el)
        );
    }

    const candidates = [
      ...document.querySelectorAll(
        '[role="radio"], button, label, ' +
        '[data-testid*="option" i], [class*="option" i]'
      )
    ]
      .filter(visible)
      .filter(el => !panel?.contains(el))
      .map(el => ({
        el,
        text: clean(el.innerText || el.getAttribute('aria-label'))
      }))
      .filter(x => x.text.length > 0 && x.text.length < 300);

    const excluded =
      /^(answer|submit answer|next|back|continue|watch video|hint|check answer)$/i;

    const filtered = candidates.filter(x => !excluded.test(x.text));

    const marked = filtered.filter(x =>
      /option/i.test(x.el.getAttribute('data-testid') || '') ||
      /option/i.test(x.el.className?.toString() || '') ||
      x.el.getAttribute('role') === 'radio'
    );

    const source = marked.length >= 2 ? marked : filtered;
    const unique = [];

    for (const item of source) {
      if (!unique.some(x => x.text === item.text)) {
        unique.push(item);
      }
    }

    return unique.length >= 2 && unique.length <= 12
      ? unique.map(x => x.el)
      : [];
  }

  function detectAnswerInterface() {
    const selects = [
      ...document.querySelectorAll('select')
    ].filter(visible).filter(el => !panel?.contains(el));

    const inputs = getVisibleAnswerInputs();

    if (inputs.length) return { type: 'inputs', inputs };

    const choices = getChoiceGroups();

    if (choices.length >= 2) {
      return { type: 'multiple-choice', choices };
    }

    if (selects.length) {
      return { type: 'dropdowns', selects };
    }

    return { type: 'unknown' };
  }

  function choiceText(el) {
    if (el.matches('input[type="radio"]')) {
      const label = el.labels?.[0] || el.parentElement;
      return clean(
        label?.innerText ||
        el.getAttribute('aria-label') ||
        el.value
      );
    }

    return clean(
      el.innerText ||
      el.getAttribute('aria-label') ||
      el.value ||
      el.textContent
    );
  }

  function setNativeValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(
      proto, 'value'
    )?.set;

    if (setter) {
      setter.call(element, String(value));
    } else {
      element.value = String(value);
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findActionButton(names) {
    const wanted = names.map(x => x.toLowerCase());

    return [
      ...document.querySelectorAll(
        'button, a, [role="button"], ' +
        'input[type="button"], input[type="submit"]'
      )
    ]
      .filter(visible)
      .find(el =>
        wanted.includes(
          clean(
            el.innerText ||
            el.value ||
            el.getAttribute('aria-label')
          ).toLowerCase()
        )
      );
  }

  async function solveQuestion(questionData, answerUI) {
    const choices = answerUI.type === 'multiple-choice'
      ? answerUI.choices.map(choiceText)
      : [];

    const dropdowns = answerUI.type === 'dropdowns'
      ? answerUI.selects.map(sel =>
          [...sel.options]
            .map(o => clean(o.textContent))
            .filter(Boolean)
        )
      : [];

    const inputCount = answerUI.type === 'inputs'
      ? answerUI.inputs.length
      : 0;

    let format;

    if (answerUI.type === 'multiple-choice') {
      format =
        'Return JSON only: {"type":"choice","index":0,' +
        '"answer":"exact option text","working":"brief steps",' +
        '"confidence":"low|medium|high"}.\n' +
        'Options numbered from 0:\n' +
        choices.map((x, i) => `${i}: ${x}`).join('\n');
    } else if (answerUI.type === 'dropdowns') {
      format =
        `There are ${dropdowns.length} dropdowns.\n` +
        'Allowed options by dropdown:\n' +
        dropdowns.map((opts, i) =>
          `${i}: ${opts.join(' | ')}`
        ).join('\n') +
        '\nReturn JSON only: {"type":"dropdowns",' +
        '"answers":["exact option text"],"working":"brief steps",' +
        '"confidence":"low|medium|high"}.' +
        ` The answers array must contain exactly ${dropdowns.length} items.`;
    } else {
      format =
        `There are ${inputCount || 'an unknown number of'} answer inputs.\n` +
        'Return JSON only: {"type":"inputs","answers":["answer 1"],' +
        '"working":"brief steps","confidence":"low|medium|high"}.' +
        ` The answers array must contain exactly ${inputCount || 'the required number of'} items.` +
        ' Use plain text, fractions like 3/4 when appropriate, ' +
        'and units if required.';
    }

    const imageNote = questionData.images.length
      ? '\nImage alt text (image pixels are NOT sent to this text-only request):\n' +
        questionData.images.map((x, i) =>
          `${i + 1}. ${x.alt || '(no alt text)'}`
        ).join('\n')
      : '';

    const raw = await requestGroq([
      {
        role: 'system',
        content:
          'You are a careful maths tutor. Solve step by step internally ' +
          'and check arithmetic. Do not invent missing diagram details. ' +
          'Return exactly one JSON object matching the requested format. ' +
          'If information is missing, say so and set confidence to low.'
      },
      {
        role: 'user',
        content:
          `Question text:\n${questionData.text}${imageNote}\n\n` +
          `${format}\n\nGive concise working and an honest confidence rating.`
      }
    ]);

    const parsed = parseJsonResponse(raw);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('The model response was not an object.');
    }

    if (answerUI.type === 'multiple-choice') {
      if (
        !Number.isInteger(parsed.index) ||
        parsed.index < 0 ||
        parsed.index >= choices.length
      ) {
        throw new Error(
          'The model returned an invalid option index.'
        );
      }
    } else {
      if (!Array.isArray(parsed.answers)) {
        throw new Error('The model did not return an answers array.');
      }

      const expected = answerUI.type === 'inputs'
        ? answerUI.inputs.length
        : answerUI.selects.length;

      if (parsed.answers.length !== expected) {
        throw new Error(
          `The model returned ${parsed.answers.length} answers, ` +
          `but the page has ${expected} fields. Nothing was filled in.`
        );
      }
    }

    return parsed;
  }

  function renderResult(solution, answerUI) {
    resultNode.replaceChildren();

    const heading = document.createElement('strong');
    heading.textContent = 'Suggested solution — review before using';
    resultNode.appendChild(heading);

    const confidence = document.createElement('p');
    confidence.textContent =
      `Confidence: ${String(solution.confidence || 'not provided')}`;
    resultNode.appendChild(confidence);

    const working = document.createElement('p');
    working.textContent =
      `Working: ${String(solution.working || 'No working provided.')}`;
    resultNode.appendChild(working);

    const answer = document.createElement('p');

    if (solution.type === 'choice') {
      answer.textContent =
        `Suggested option: ${solution.index}. ${solution.answer || ''}`;
    } else {
      answer.textContent =
        `Suggested answer(s): ${(solution.answers || []).map(String).join(' ; ')}`;
    }

    resultNode.appendChild(answer);

    const apply = document.createElement('button');
    apply.textContent = 'Fill suggested answer(s)';
    apply.style.marginRight = '8px';

    apply.onclick = () => {
      try {
        if (answerUI.type === 'inputs') {
          solution.answers.forEach((value, i) => {
            setNativeValue(answerUI.inputs[i], value);
          });
        } else if (answerUI.type === 'multiple-choice') {
          const el = answerUI.choices[solution.index];
          const radio = el.matches('input[type="radio"]')
            ? el
            : el.querySelector('input[type="radio"]');

          if (radio) {
            radio.click();
            radio.checked = true;
            radio.dispatchEvent(
              new Event('change', { bubbles: true })
            );
          } else {
            el.click();
          }
        } else if (answerUI.type === 'dropdowns') {
          solution.answers.forEach((value, i) => {
            const select = answerUI.selects[i];

            const option = [...select.options].find(o =>
              clean(o.textContent).toLowerCase() ===
              String(value).trim().toLowerCase()
            );

            if (!option) {
              throw new Error(
                `Could not match "${value}" in dropdown ${i + 1}.`
              );
            }

            select.value = option.value;
            select.dispatchEvent(
              new Event('input', { bubbles: true })
            );
            select.dispatchEvent(
              new Event('change', { bubbles: true })
            );
          });
        }

        setStatus(
          'Suggested answer filled. Review it yourself before submitting.'
        );
      } catch (error) {
        setStatus(error.message, true);
      }
    };

    resultNode.appendChild(apply);

    const clear = document.createElement('button');
    clear.textContent = 'Clear result';
    clear.onclick = () => resultNode.replaceChildren();
    resultNode.appendChild(clear);
  }

  async function analyzeCurrentQuestion() {
    if (busy) return;

    busy = true;
    cancelled = false;

    try {
      if (!validateKey()) {
        throw new Error(
          'Set GROQ_API_KEY near the top of the script to your own API key.'
        );
      }

      setStatus('Reading the current question…');

      const questionData = readQuestion();
      log('Question text:', questionData.text);

      let answerUI = detectAnswerInterface();

      if (answerUI.type === 'unknown') {
        const answerButton = findActionButton(['Answer']);

        if (!answerButton) {
          throw new Error(
            'Could not identify answer fields or find an Answer button. ' +
            'Sparx may have changed its page layout.'
          );
        }

        const oldText = questionData.text;

        setStatus('Opening the answer interface…');
        answerButton.click();

        const start = Date.now();

        while (
          Date.now() - start < 12000 &&
          answerUI.type === 'unknown'
        ) {
          if (cancelled) throw new Error('Stopped by user.');
          await sleep(POLL_MS);
          answerUI = detectAnswerInterface();
        }

        if (answerUI.type === 'unknown') {
          throw new Error(
            'Could not identify answer fields. No answer was entered.'
          );
        }

        questionData.text = oldText;
      }

      setStatus('Asking Groq for a worked solution…');

      const solution = await solveQuestion(questionData, answerUI);

      if (cancelled) throw new Error('Stopped by user.');

      renderResult(solution, answerUI);

      setStatus(
        'Solution ready. Review the working and answer before using it.'
      );
    } catch (error) {
      console.error('[Sparx study helper]', error);
      setStatus(error?.message || String(error), true);
    } finally {
      busy = false;
    }
  }

  function makePanel() {
    if (document.querySelector('#sparx-study-helper')) return;

    panel = document.createElement('section');
    panel.id = 'sparx-study-helper';

    Object.assign(panel.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      width: '340px',
      maxHeight: '70vh',
      overflow: 'auto',
      zIndex: '2147483647',
      background: '#fff',
      color: '#172033',
      border: '2px solid #334155',
      borderRadius: '10px',
      padding: '12px',
      boxShadow: '0 8px 30px rgba(0,0,0,.25)',
      font: '14px/1.4 Arial, sans-serif'
    });

    const title = document.createElement('div');
    title.textContent = 'Sparx Maths Study Assistant';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';

    statusNode = document.createElement('p');
    statusNode.textContent =
      'Ready. Open a question, then choose Analyse current question.';

    const analyze = document.createElement('button');
    analyze.textContent = 'Analyse current question';
    analyze.style.marginRight = '8px';
    analyze.onclick = analyzeCurrentQuestion;

    const stop = document.createElement('button');
    stop.textContent = 'Stop';
    stop.onclick = () => {
      cancelled = true;
      setStatus('Stop requested.');
    };

    resultNode = document.createElement('div');
    resultNode.style.marginTop = '10px';
    resultNode.style.borderTop = '1px solid #cbd5e1';
    resultNode.style.paddingTop = '8px';

    panel.append(
      title, statusNode, analyze, stop, resultNode, note
    );

    document.body.appendChild(panel);
  }

  if (location.hostname.toLowerCase() === 'maths.sparx-learning.com') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', makePanel, {
        once: true
      });
    } else {
      makePanel();
    }
  }
})();
