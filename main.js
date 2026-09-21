// ==UserScript==
// @name         sparx-bot
// @namespace    https://github.com/xfwmk/sparx-bot/
// @version      1
// @description  Sparx Maths test bot
// @match        https://maths.sparx-learning.com/student/*
// @connect      api.groq.com
// @copyright    xfwmk - opel - kian
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // PUT YOUR NEW GROQ API KEY BETWEEN THE QUOTES
    // ============================================================

    const GROQ_API_KEY = 'GROQ_API_KEY';

    // ============================================================

    const MODEL = 'openai/gpt-oss-20b';

    let running = false;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    // ============================================================
    // GROQ
    // ============================================================

    function askGroq(question, answerType, numberOfInputs, choices) {

        return new Promise((resolve, reject) => {

            let instructions = '';

            if (answerType === 'inputs') {

                instructions = `
Solve every part of the question.

Return ONLY a JSON array containing the answers in order.

Example:
["9","11","13"]

For a single answer:
["9"]

Do not include A=, B=, C=.
Do not explain anything.
`;

            } else if (answerType === 'multiple-choice') {

                instructions = `
This is a multiple-choice question.

The possible answers are:

${choices.map((x, i) => `${i}: ${x}`).join('\n')}

Reply ONLY with the number of the correct option.

For example:

2

Do not explain anything.
`;

            } else {

                instructions = `
Determine the answer to the maths question.

Reply with ONLY the answer.
Do not explain anything.
`;
            }


            const prompt = `
You are solving a mathematics question.

Question:

${question}

${instructions}
`;


            GM_xmlhttpRequest({

                method: 'POST',

                url: 'https://api.groq.com/openai/v1/chat/completions',

                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_API_KEY}`
                },

                data: JSON.stringify({

                    model: MODEL,

                    messages: [

                        {
                            role: 'system',
                            content:
                                'You solve mathematics questions accurately. Follow the requested output format exactly.'
                        },

                        {
                            role: 'user',
                            content: prompt
                        }

                    ],

                    temperature: 0

                }),

                onload: function (response) {

                    if (
                        response.status < 200 ||
                        response.status >= 300
                    ) {

                        reject(
                            new Error(
                                `Groq HTTP ${response.status}: ${response.responseText}`
                            )
                        );

                        return;
                    }


                    try {

                        const data =
                            JSON.parse(response.responseText);

                        const text =
                            data?.choices?.[0]?.message?.content?.trim();


                        if (!text) {

                            reject(
                                new Error(
                                    'Groq returned an empty answer.'
                                )
                            );

                            return;
                        }


                        resolve(text);

                    } catch (error) {

                        reject(error);
                    }
                },


                onerror: function () {

                    reject(
                        new Error(
                            'Could not connect to Groq.'
                        )
                    );
                }

            });

        });
    }


    // ============================================================
    // PAGE TEXT
    // ============================================================

    function getPageText() {

        return document.body.innerText
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }


    // ============================================================
    // FIND BUTTON BY TEXT
    // ============================================================

    function findButton(text) {

        const elements = [
            ...document.querySelectorAll(
                'button, a, [role="button"], input[type="button"], input[type="submit"]'
            )
        ];

        return elements.find(element => {

            const elementText =
                (
                    element.innerText ||
                    element.value ||
                    element.getAttribute('aria-label') ||
                    ''
                )
                .trim()
                .toLowerCase();

            return elementText === text.toLowerCase();

        });
    }


    // ============================================================
    // WAIT FOR BUTTON
    // ============================================================

    async function waitForButton(text) {

        for (;;) {

            if (!running) {
                return null;
            }

            const button = findButton(text);

            if (button) {
                return button;
            }

            await sleep(300);
        }
    }


    // ============================================================
    // GET ANSWER INPUTS
    // ============================================================

    function getAnswerInputs() {

        const inputs = [
            ...document.querySelectorAll(
                'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])'
            )
        ];

        return inputs.filter(input => {

            const rect =
                input.getBoundingClientRect();

            const style =
                window.getComputedStyle(input);

            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden'
            );
        });
    }


    // ============================================================
    // GET MULTIPLE CHOICE OPTIONS
    // ============================================================

    function getChoices() {

        const elements = [
            ...document.querySelectorAll(
                'button, [role="button"], label'
            )
        ];

        return elements.filter(element => {

            const text =
                element.innerText?.trim();

            if (!text) {
                return false;
            }

            const rect =
                element.getBoundingClientRect();

            return (
                rect.width > 20 &&
                rect.height > 20
            );
        });
    }


    // ============================================================
    // DETECT ANSWER TYPE
    // ============================================================

    function detectAnswerType() {

        const inputs =
            getAnswerInputs();

        if (inputs.length > 0) {

            return {
                type: 'inputs',
                inputs
            };
        }


        const choices =
            getChoices();

        if (choices.length > 1) {

            return {
                type: 'multiple-choice',
                choices
            };
        }


        return {
            type: 'unknown'
        };
    }


    // ============================================================
    // SET INPUT VALUE PROPERLY
    // ============================================================

    function setInputValue(input, value) {

        const nativeSetter =
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            )?.set;

        if (nativeSetter) {

            nativeSetter.call(
                input,
                String(value)
            );

        } else {

            input.value =
                String(value);
        }


        input.dispatchEvent(
            new Event(
                'input',
                {
                    bubbles: true
                }
            )
        );


        input.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true
                }
            )
        );
    }


    // ============================================================
    // QUESTION
    // ============================================================

    async function getQuestionScreen() {

        console.log(
            'Waiting for Sparx question...'
        );


        for (;;) {

            if (!running) {
                return null;
            }


            const text =
                getPageText();


            if (
                text &&
                (
                    text.includes('Answer') ||
                    text.includes('Watch video')
                )
            ) {

                return text;
            }


            await sleep(500);
        }
    }


    function showAnswer(answer) {

    let values;

    try {
        values = JSON.parse(answer);
    } catch {
        values = [answer];
    }

    const old = document.querySelector('#sparx-ai-answer');

    if (old) old.remove();

    const box = document.createElement('div');

    box.id = 'sparx-ai-answer';

    box.style.position = 'fixed';
    box.style.top = '20px';
    box.style.right = '20px';
    box.style.zIndex = '9999999';
    box.style.background = 'white';
    box.style.border = '3px solid black';
    box.style.padding = '15px';
    box.style.fontFamily = 'Arial';
    box.style.fontSize = '20px';

    box.innerHTML =
        '<b>AI answer</b><br><br>' +
        values.map(
            (x, i) => `${String.fromCharCode(65 + i)} = ${x}`
        ).join('<br>');

    document.body.appendChild(box);
}

    // ============================================================
    // ANSWER ONE QUESTION
    // ============================================================

    async function answerQuestion() {

    // ============================================================
    // 1. READ QUESTION PAGE
    // ============================================================

    const question =
        await getQuestionScreen();

    if (!question) {
        return;
    }

    console.log('================================');
    console.log('SPARX QUESTION');
    console.log(question);


    // ============================================================
    // 2. ASK GROQ WHILE QUESTION IS STILL ON SCREEN
    // ============================================================

    console.log('Asking Groq BEFORE clicking Answer...');

    /*
     * We don't know yet how many answer boxes there will be,
     * so initially ask Groq to return answers separated by |.
     *
     * Example:
     *
     * 9|11|13
     */

    const aiAnswer =
    await askGroq(
        question,
        'inputs',
        0,
        []
    );

    console.log(
        'AI calculated answer:',
        aiAnswer
    );


    // ============================================================
    // 3. STORE THE ANSWER
    // ============================================================

    let storedAnswers;

try {
    storedAnswers = JSON.parse(aiAnswer);

    if (!Array.isArray(storedAnswers)) {
        throw new Error('AI response was not an array');
    }

    storedAnswers =
        storedAnswers.map(x => String(x).trim());

} catch (e) {
    throw new Error(
        `Groq returned an invalid answer:\n${aiAnswer}`
    );
}

    console.log(
        'Stored answers:',
        storedAnswers
    );

    showAnswer(JSON.stringify(storedAnswers));

    if (storedAnswers.length === 0) {

        throw new Error(
            'Groq did not return an answer.'
        );
    }


    // ============================================================
    // 4. NOW CLICK "ANSWER"
    // ============================================================

    const answerButton =
        await waitForButton('Answer');

    if (!answerButton) {
        throw new Error(
            'Could not find Answer button.'
        );
    }

    console.log(
        'Clicking Answer...'
    );

    answerButton.click();


    // ============================================================
    // 5. WAIT FOR ANSWER PAGE
    // ============================================================

    let answerData = null;

    for (let i = 0; i < 100; i++) {

        if (!running) {
            return;
        }

        answerData =
            detectAnswerType();

        if (
            answerData.type !== 'unknown'
        ) {
            break;
        }

        await sleep(200);
    }


    if (
        !answerData ||
        answerData.type === 'unknown'
    ) {

        throw new Error(
            'Could not detect the Sparx answer interface.'
        );
    }


    console.log(
        'Answer interface:',
        answerData.type
    );


    // ============================================================
    // 6. NUMBER INPUTS
    // ============================================================

    if (
        answerData.type === 'inputs'
    ) {

        const inputs =
            answerData.inputs;

        console.log(
            'Sparx has',
            inputs.length,
            'input boxes.'
        );


        /*
         * IMPORTANT:
         *
         * The answer was calculated BEFORE navigating to this page.
         *
         * We now simply match the stored answers to the
         * input boxes.
         */


        if (
            storedAnswers.length !==
            inputs.length
        ) {

            throw new Error(
                `Sparx has ${inputs.length} answer boxes, but AI returned ${storedAnswers.length} answers.\n\nAI answer: ${aiAnswer}`
            );
        }


        for (
            let i = 0;
            i < inputs.length;
            i++
        ) {

            console.log(
                `Putting ${storedAnswers[i]} into input ${i + 1}`
            );


            setInputValue(
                inputs[i],
                storedAnswers[i]
            );


            await sleep(300);
        }
    }


    // ============================================================
    // 7. MULTIPLE CHOICE
    // ============================================================

    else if (
        answerData.type ===
        'multiple-choice'
    ) {

        /*
         * For multiple choice, Groq should return the
         * index of the option.
         */

        const choices =
            answerData.choices;


        const choiceTexts =
            choices.map(
                choice =>
                    choice.innerText.trim()
            );


        console.log(
            'Choices:',
            choiceTexts
        );


        /*
         * We already have the question stored.
         *
         * Ask Groq using the stored question rather than
         * trying to reconstruct it from the answer page.
         */

        const choiceAnswer =
            await askGroq(
                question,
                'multiple-choice',
                1,
                choiceTexts
            );


        const match =
            choiceAnswer.match(/\d+/);


        if (!match) {

            throw new Error(
                `Groq returned an invalid choice: ${choiceAnswer}`
            );
        }


        const index =
            Number(match[0]);


        if (
            index < 0 ||
            index >= choices.length
        ) {

            throw new Error(
                `Invalid choice index: ${index}`
            );
        }


        console.log(
            'Selecting:',
            choiceTexts[index]
        );


        choices[index].click();
    }


    // ============================================================
    // 8. SUBMIT
    // ============================================================

    await sleep(500);


    const submit =
        findButton('Submit answer');


    if (!submit) {

        throw new Error(
            'Could not find Submit answer button.'
        );
    }


    console.log(
        'Submitting answer...'
    );


    submit.click();


    // ============================================================
    // 9. WAIT FOR RESULT
    // ============================================================

    await sleep(2000);


    console.log(
        'Answer submitted.'
    );


    // ============================================================
    // 10. NEXT QUESTION
    // ============================================================

    const next =
        findButton('Next');


    if (!next) {

        console.log(
            'No Next button found.'
        );

        console.log(
            'Sparx section appears to have finished.'
        );

        running = false;

        return;
    }


    console.log(
        'Moving to next question...'
    );


    next.click();


    await sleep(1500);
}


    // ============================================================
    // MAIN BOT
    // ============================================================

    async function runBot() {

        if (running) {
            return;
        }


        if (
            !GROQ_API_KEY ||
            GROQ_API_KEY ===
                'PASTE_YOUR_NEW_GROQ_KEY_HERE'
        ) {

            alert(
                'Enter your Groq API key in the script first.'
            );

            return;
        }


        if (
            !location.hostname
                .toLowerCase()
                .includes('sparx-learning.com')
        ) {

            alert(
                'This does not appear to be a Sparx Maths page.'
            );

            return;
        }


        running = true;


        console.log(
            '================================'
        );

        console.log(
            'SPARX AI BOT STARTED'
        );

        console.log(
            '================================'
        );


        while (running) {

            try {

                await answerQuestion();

            } catch (error) {

                console.error(
                    'SPARX BOT ERROR:',
                    error
                );


                running = false;


                alert(
                    'Sparx AI bot stopped.\n\n' +
                    error.message
                );
            }
        }
    }


    // ============================================================
    // STOP
    // ============================================================

    function stopBot() {

        running = false;

        console.log(
            'SPARX AI BOT STOPPED'
        );
    }


    // ============================================================
    // CONTROL PANEL
    // ============================================================

    function createPanel() {

        if (
            document.querySelector(
                '#sparx-ai-panel'
            )
        ) {
            return;
        }


        const panel =
            document.createElement('div');


        panel.id =
            'sparx-ai-panel';


        panel.style.position =
            'fixed';

        panel.style.bottom =
            '20px';

        panel.style.right =
            '20px';

        panel.style.zIndex =
            '999999';

        panel.style.background =
            'white';

        panel.style.border =
            '2px solid #222';

        panel.style.padding =
            '10px';

        panel.style.borderRadius =
            '8px';

        panel.style.fontFamily =
            'Arial, sans-serif';

        panel.style.boxShadow =
            '0 3px 15px rgba(0,0,0,.25)';


        const title =
            document.createElement('div');

        title.innerText =
            'Sparx AI Bot';

        title.style.fontWeight =
            'bold';

        title.style.marginBottom =
            '8px';


        const start =
            document.createElement('button');

        start.innerText =
            'START AI BOT';

        start.style.padding =
            '8px 12px';

        start.style.marginRight =
            '5px';

        start.style.cursor =
            'pointer';


        start.onclick =
            runBot;


        const stop =
            document.createElement('button');

        stop.innerText =
            'STOP';

        stop.style.padding =
            '8px 12px';

        stop.style.cursor =
            'pointer';


        stop.onclick =
            stopBot;


        panel.appendChild(
            title
        );

        panel.appendChild(
            start
        );

        panel.appendChild(
            stop
        );


        document.body.appendChild(
            panel
        );
    }


    // ============================================================
    // START ON SPARX
    // ============================================================

    if (
        location.hostname
            .toLowerCase()
            .includes('maths.sparx-learning.com')
    ) {

        createPanel();
    }

})();
