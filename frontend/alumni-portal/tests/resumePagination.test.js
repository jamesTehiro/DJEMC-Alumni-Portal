import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateResumeDocument, A4_WIDTH_PX, A4_HEIGHT_PX } from '../src/components/resume/templates/paginateResumeDocument.js';

// Deterministic DOM measurements isolate page-placement logic from browser fonts.
class Element {
    constructor(ownerDocument, className = '') { this.ownerDocument = ownerDocument; this.className = className; this.children = []; this.attributes = {}; this.text = ''; this.parentElement = null; this.classList = { add: name => { this.className += ` ${name}`; } }; }
    hasClass(name) { return this.className.split(/\s+/).includes(name); }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this.text = text; this.children = []; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { const found = []; const visit = element => { for (const child of element.children) { if (child.hasClass(selector.slice(1))) found.push(child); visit(child); } }; visit(this); return found; }
    cloneNode(deep) { const node = new Element(this.ownerDocument, this.className); node.attributes = { ...this.attributes }; node.text = this.text; if (deep) this.children.forEach(child => node.appendChild(child.cloneNode(true))); return node; }
    height() {
        if (this.hasClass('djemc-resume-header')) return 150;
        if (this.hasClass('djemc-resume-continuation-header')) return 45;
        if (this.hasClass('djemc-resume-section-heading')) return 40;
        if (this.hasClass('djemc-resume-section')) return this.children.reduce((sum, child) => sum + child.height(), 0) + 18;
        if (this.hasClass('djemc-resume-entry')) return this.children.reduce((sum, child) => sum + child.height(), 0) + 10;
        if (this.children.length) return this.children.reduce((sum, child) => sum + child.height(), 0);
        return Math.ceil(this.text.length / 85) * 18;
    }
    getBoundingClientRect() {
        if (this.hasClass('djemc-resume-page')) return { top: 0, bottom: A4_HEIGHT_PX, width: A4_WIDTH_PX, height: A4_HEIGHT_PX };
        if (this.hasClass('djemc-resume-body')) return { bottom: 53 + this.parentElement.children[0].height() + this.height() };
        return { bottom: this.height() };
    }
}
function fixture(entries, extraSections = []) {
    const document = { createElement: () => new Element(document), defaultView: { getComputedStyle: () => ({ paddingBottom: '64' }) } };
    const make = (className, text = '') => { const element = new Element(document, className); element.textContent = text; return element; };
    const source = make('djemc-resume-document');
    const header = make('djemc-resume-header'); header.append(make('djemc-resume-name', 'Alex Graduate')); source.append(header);
    const body = make('djemc-resume-body'); source.append(body);
    for (const [index, descriptions] of [entries, ...extraSections].entries()) {
        const section = make('djemc-resume-section'); section.append(make('djemc-resume-section-heading', `Section ${index + 1}`));
        const list = make('djemc-resume-section-entries'); section.append(list); body.append(section);
        descriptions.forEach((description, entryIndex) => { const entry = make('djemc-resume-entry'); entry.append(make('djemc-resume-entry-title', `Entry ${index + 1}-${entryIndex + 1}`), make('djemc-resume-entry-description', description)); list.append(entry); });
    }
    return { source, stage: make('stage') };
}
function paginate(entries, extraSections) { const { source, stage } = fixture(entries, extraSections); return paginateResumeDocument(source, stage); }

test('short resume stays on one A4 page with its header and page number', () => {
    const pages = paginate(['Short description.']);
    assert.equal(pages.length, 1); assert.equal(pages[0].attributes['data-page-number'], '1');
    assert.equal(pages[0].querySelector('.djemc-resume-page-footer').textContent, '1 / 1');
    assert.ok(pages[0].querySelector('.djemc-resume-header'));
});

test('many entries move to later pages without duplication or loss', () => {
    const descriptions = Array.from({ length: 18 }, (_, index) => `Distinct entry ${index}. ` + 'Experience and achievements. '.repeat(14));
    const pages = paginate(descriptions);
    assert.ok(pages.length > 1);
    const rendered = pages.flatMap(page => page.querySelectorAll('.djemc-resume-entry-description').map(part => part.textContent));
    assert.deepEqual(rendered, descriptions);
    assert.ok(pages[1].querySelector('.djemc-resume-continuation-header'));
    pages.forEach(page => assert.ok(page.querySelector('.djemc-resume-body').getBoundingClientRect().bottom <= A4_HEIGHT_PX - 64));
});

test('a single description longer than a page splits without truncating text', () => {
    const description = 'Long professional experience with achievements and responsibilities. '.repeat(320);
    const pages = paginate([description]);
    assert.ok(pages.length > 3);
    const rendered = pages.flatMap(page => page.querySelectorAll('.djemc-resume-entry-description').map(part => part.textContent)).join('');
    assert.equal(rendered, description);
    assert.ok(pages[1].querySelector('.djemc-resume-entry-continuation'));
});

test('long unbroken text wraps and splits safely at a character boundary', () => {
    const description = 'x'.repeat(12000);
    const pages = paginate([description]);
    assert.ok(pages.length > 1);
    assert.equal(pages.flatMap(page => page.querySelectorAll('.djemc-resume-entry-description').map(part => part.textContent)).join(''), description);
});

test('all sections retain their order and every page footer uses the final total', () => {
    const pages = paginate(['First section. '.repeat(240)], [['Second section. '.repeat(200)], ['Third section.']]);
    const descriptions = pages.flatMap(page => page.querySelectorAll('.djemc-resume-entry-description').map(part => part.textContent)).join('');
    assert.equal(descriptions, 'First section. '.repeat(240) + 'Second section. '.repeat(200) + 'Third section.');
    pages.forEach((page, index) => assert.equal(page.querySelector('.djemc-resume-page-footer').textContent, `${index + 1} / ${pages.length}`));
});
