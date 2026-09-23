import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const indexScript = readFileSync('app/static/index.js', 'utf8');
const indexTemplate = readFileSync('app/templates/index.html', 'utf8');
const openDoms = [];

function loadIndex() {
    const html = indexTemplate
        .replace(/\{%[\s\S]*?%\}/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM(html, {
        url: 'http://localhost/songfy/',
        runScripts: 'outside-only',
    });
    openDoms.push(dom);
    let readyListener;
    const addEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') readyListener = listener;
        else addEventListener(type, listener, options);
    };
    dom.window.eval(indexScript);
    dom.window.document.addEventListener = addEventListener;
    readyListener();
    return dom;
}

afterEach(() => {
    vi.restoreAllMocks();
    while (openDoms.length) openDoms.pop().window.close();
});

describe('room home page', () => {
    it('shows an API failure when room creation fails', async () => {
        const dom = loadIndex();
        dom.window.fetch = vi.fn(async () => ({ ok: false, status: 500 }));

        await dom.window.createRoom();

        expect(dom.window.fetch).toHaveBeenCalledWith('/songfy/api/rooms', {
            method: 'POST',
            credentials: 'same-origin',
        });
        expect(dom.window.document.querySelector('#create-room-error').textContent)
            .toBe('Unable to create room.');
        expect(dom.window.document.querySelector('#create-room-error').hidden).toBe(false);
    });

    it('normalizes a room code before validating it', () => {
        const dom = loadIndex();
        const input = dom.window.document.querySelector('#room-code-input');
        input.value = ' bad ';
        input.reportValidity = vi.fn();

        dom.window.joinRoom({ preventDefault() {} });

        expect(input.validationMessage).toBe('Enter a valid six-character room code.');
        expect(input.reportValidity).toHaveBeenCalledOnce();
    });
});
