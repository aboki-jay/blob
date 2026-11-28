// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { OVERLAY_TAG, describeElement, isPrivateField, resolveAnchor } from '@/lib/anchor';

const $ = (selector: string) => document.querySelector(selector)!;

const CARDS = `
  <main>
    <h1>Studio</h1>
    <section class="card"><h2>Clear structure</h2><p>Find a place for every idea.</p><a class="more" href="/structure">Learn more</a></section>
    <section class="card"><h2>Room to create</h2><p>Explore and share feedback.</p><a class="more" href="/create">Learn more</a></section>
    <section class="card"><h2>A shared perspective</h2><p>Talk about the work.</p><a class="more" href="/shared">Learn more</a></section>
    <button id="cta" class="btn btn-primary css-1x2y3z9">Explore our work</button>
  </main>`;

beforeEach(() => {
  document.body.innerHTML = CARDS;
});

describe('describing an element', () => {
  it('records a selector, a little text, context and a readable label', () => {
    const d = describeElement($('#cta'));
    expect(d).toMatchObject({ selector: '#cta', tag: 'button', id: 'cta', text: 'Explore our work', label: 'Button “Explore our work”' });
    // Machine-made class names are left out.
    expect(d.classes).toEqual(['btn', 'btn-primary']);
    expect(d.offset).toEqual({ x: 1, y: 0 });
  });

  it('uses the nearest heading to tell repeated elements apart', () => {
    const links = document.querySelectorAll('a.more');
    expect(describeElement(links[0]!).context).toBe('Clear structure');
    expect(describeElement(links[2]!).context).toBe('A shared perspective');
    expect(describeElement(links[1]!).selector).toBe('body > main > section:nth-of-type(2) > a');
  });

  it('keeps only a link’s path, never its query string', () => {
    document.body.innerHTML = '<a href="https://example.com/reset?token=SECRET#frag">Reset</a>';
    expect(JSON.stringify(describeElement($('a')))).not.toContain('SECRET');
    expect(describeElement($('a')).attrs?.href).toBe('/reset');
  });

  it('never reads what a person typed', () => {
    document.body.innerHTML = `
      <form>
        <label>Card <input name="card" type="text" value="4111 1111 1111 1111"></label>
        <input id="pw" type="password" value="hunter2">
        <textarea name="notes">private notes</textarea>
        <div id="editor" contenteditable="true">draft <b>message</b></div>
        <select name="plan"><option selected>Secret plan</option></select>
      </form>`;
    ($('#pw') as HTMLInputElement).value = 'changed-by-user';
    for (const selector of ['input[name=card]', '#pw', 'textarea', '#editor', '#editor b', 'select', 'label', 'form']) {
      const json = JSON.stringify(describeElement($(selector)));
      expect(json, selector).not.toMatch(/4111|hunter2|changed-by-user|private notes|draft|message|Secret plan/);
    }
    expect(isPrivateField($('#editor b'))).toBe(true);
    expect(describeElement($('#pw')).label).toBe('Password field');
    // The field can still be found again, by its attributes.
    expect(resolveAnchor(describeElement($('textarea')))).toMatchObject({ status: 'found', element: $('textarea') });
  });
});

describe('finding it again', () => {
  it('finds an unchanged element', () => {
    const d = describeElement($('#cta'));
    document.body.innerHTML = CARDS; // a reload: same markup, new elements
    expect(resolveAnchor(d)).toMatchObject({ status: 'found', element: $('#cta') });
  });

  it('picks the right one among elements with the same text', () => {
    const second = document.querySelectorAll('a.more')[1]!;
    const d = describeElement(second);
    document.body.innerHTML = CARDS;
    const result = resolveAnchor(d);
    expect(result.status === 'found' && result.element.getAttribute('href')).toBe('/create');
  });

  it('follows a target that moved elsewhere on the page', () => {
    const d = describeElement($('#cta'));
    document.body.innerHTML = `<header><nav><span>Menu</span><button id="cta" class="btn">Explore our work</button></nav></header><main><h1>Studio</h1></main>`;
    expect(resolveAnchor(d)).toMatchObject({ status: 'found', element: $('#cta') });
  });

  it('follows a moved target that has no id, using its text', () => {
    document.body.innerHTML = '<main><p>Intro</p><button>Start free trial</button></main>';
    const d = describeElement($('button'));
    document.body.innerHTML = '<main><p>Intro</p><div><div><button>Other</button><button>Start free trial</button></div></div></main>';
    const result = resolveAnchor(d);
    expect(result.status === 'found' && result.element.textContent).toBe('Start free trial');
  });

  it('follows a repeated element when its section is reordered', () => {
    const d = describeElement(document.querySelectorAll('a.more')[0]!);
    const main = $('main');
    main.insertBefore(main.querySelectorAll('section')[2]!, main.querySelectorAll('section')[0]!);
    const result = resolveAnchor(d);
    // The selector now points at a look-alike in another card; the heading gives it away.
    expect(result.status === 'found' && result.element.getAttribute('href')).toBe('/structure');
  });

  it('reports a removed target as unavailable', () => {
    const d = describeElement($('#cta'));
    $('#cta').remove();
    expect(resolveAnchor(d)).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('does not settle for a different element that took the same place', () => {
    document.body.innerHTML = '<ul><li>Apples</li><li>Bananas</li><li>Cherries</li></ul>';
    const d = describeElement(document.querySelectorAll('li')[1]!);
    document.body.innerHTML = '<ul><li>Apples</li><li>Dates</li><li>Cherries</li></ul>';
    expect(resolveAnchor(d)).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('prefers "unavailable" over guessing between identical elements', () => {
    document.body.innerHTML = '<div><button>Buy</button></div>';
    const d = describeElement($('button'));
    document.body.innerHTML = '<section><p>New layout</p><span><button>Buy</button></span><span><button>Buy</button></span></section>';
    expect(resolveAnchor(d)).toEqual({ status: 'unavailable', reason: 'ambiguous' });
  });

  it('survives a selector that is no longer valid CSS', () => {
    const d = { ...describeElement($('#cta')), selector: 'main >> ??? [' };
    expect(resolveAnchor(d)).toMatchObject({ status: 'found', element: $('#cta') });
  });

  it('never resolves to Blob’s own interface', () => {
    document.body.innerHTML = '<main><button>Send</button></main>';
    const d = describeElement($('button'));
    document.body.innerHTML = `<${OVERLAY_TAG}><button>Send</button></${OVERLAY_TAG}>`;
    expect(resolveAnchor(d).status).toBe('unavailable');
  });
});
