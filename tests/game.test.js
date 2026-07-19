import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const gameScript = readFileSync('app/static/scripts.js', 'utf8');

function loadGame(search = '?player=Alice&player=Roberto') {
    const dom = new JSDOM(`
        <main id="gameplayContainer">
        <h1 id="roundHeader"></h1>
        <p id="resultMessage" hidden></p>
        <div id="gameLoader"></div>
        <div id="buttonContainer" class="button-container">
        <button id="playBtn" disabled></button>
        <button id="nextBtn" disabled></button>
        </div>
        <div id="infoContainer" class="info-container"></div>
        <span id="songNamePointsLabel"></span>
        <span id="artistPointsLabel"></span>
        <span id="releaseYearPointsLabel"></span>
        <input id="songNameCheckbox" type="checkbox">
        <input id="artistsCheckbox" type="checkbox">
        <input id="releaseDateCheckbox" type="checkbox">
        <button id="confirmButton" disabled></button>
        <div class="players-container"></div>
        </main>
        <ol id="rankingsList"></ol>
        <section id="endGameContainer" hidden></section>
    `, {
        url: `http://localhost/songfy/game${search}`,
        runScripts: 'outside-only',
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
        get() { return this.textContent; },
        set(value) { this.textContent = value; },
    });

    const addEventListener = dom.window.document.addEventListener.bind(
        dom.window.document
    );
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type !== 'DOMContentLoaded') {
            addEventListener(type, listener, options);
        }
    };
    dom.window.eval(gameScript);
    dom.window.document.addEventListener = addEventListener;
    return dom;
}

describe('game settings', () => {
    it('unblocks controls after songs finish loading', () => {
        const dom = loadGame();
        const document = dom.window.document;

        dom.window.finishSongLoading();

        expect(document.querySelector('#gameLoader').hidden).toBe(true);
        expect(document.querySelector('#playBtn').disabled).toBe(true);
        expect(document.querySelector('#nextBtn').disabled).toBe(false);
        expect(document.querySelector('#confirmButton').disabled).toBe(false);
    });

    it('accepts valid integers and falls back for invalid settings', () => {
        const dom = loadGame('?player=Alice&rounds=3&songNamePoints=-1');
        expect(dom.window.eval("getIntegerSetting('rounds', 10, 1, 100)")).toBe(3);
        expect(dom.window.eval("getIntegerSetting('songNamePoints', 2, 0, 100)")).toBe(2);
        expect(dom.window.eval("getIntegerSetting('missing', 25, 1, 300)")).toBe(25);
    });

    it('renders configured points beside each answer', () => {
        const dom = loadGame(
            '?player=Alice&songNamePoints=2&artistPoints=3&releaseYearPoints=4'
        );
        dom.window.renderConfiguredPoints();
        const document = dom.window.document;
        expect(document.querySelector('#songNamePointsLabel').textContent).toBe('(+2)');
        expect(document.querySelector('#artistPointsLabel').textContent).toBe('(+3)');
        expect(document.querySelector('#releaseYearPointsLabel').textContent).toBe('(+4)');
    });
});

describe('turn scoring', () => {
    it('awards points, advances the player, and announces the result', () => {
        const dom = loadGame(
            '?player=Alice&player=Roberto&rounds=10&songNamePoints=2' +
            '&artistPoints=1&releaseYearPoints=3'
        );
        const document = dom.window.document;
        dom.window.renderScoreboard();
        dom.window.renderRoundHeader();
        document.querySelector('#songNameCheckbox').checked = true;
        document.querySelector('#releaseDateCheckbox').checked = true;

        dom.window.finishPlayerTurn();

        expect(document.querySelector('.points').textContent).toBe('5');
        expect(document.querySelector('#resultMessage').textContent)
            .toBe('Alice earned 5 points.');
        expect(document.querySelectorAll('.player-container')[1].classList)
            .toContain('current-player');
        expect(document.querySelector('#roundHeader').textContent)
            .toBe('Round 1 of 10 — Roberto’s turn.');
    });

    it('increments the round after the final player turn', () => {
        const dom = loadGame('?player=Alice&player=Roberto&rounds=10');
        const document = dom.window.document;
        dom.window.renderScoreboard();
        dom.window.finishPlayerTurn();
        dom.window.finishPlayerTurn();
        expect(document.querySelector('#roundHeader').textContent)
            .toBe('Round 2 of 10 — Alice’s turn.');
    });
});

describe('end game', () => {
    it('orders final rankings by total points', () => {
        const dom = loadGame();
        const document = dom.window.document;
        dom.window.renderScoreboard();
        const scores = document.querySelectorAll('.points');
        scores[0].textContent = '2';
        scores[1].textContent = '7';

        dom.window.showEndGame();

        const rankings = [...document.querySelectorAll('#rankingsList li')]
            .map(item => item.querySelector('.ranking-player').textContent);
        expect(rankings).toEqual(['Roberto', 'Alice']);
        expect(document.querySelector('.ranking-winner .ranking-points').textContent)
            .toBe('7 points');
        expect(document.querySelector('#endGameContainer').hidden).toBe(false);
        expect(document.querySelector('#gameplayContainer').hidden).toBe(true);
    });
});
