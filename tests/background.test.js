import assert from 'node:assert/strict';
import test from 'node:test';
import { mountBackground } from '../js/background.js';

for (const state of ['loading', 'error']) {
  test(`default background ignores ${state} character asset`, async (t) => {
    const images = [];
    const elements = new Map();
    class Element extends EventTarget {
      hidden = false;
      textContent = '';
      setAttribute() {}
    }
    const container = {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, new Element());
        return elements.get(selector);
      },
    };
    const globals = {
      Image: class {
        constructor() { images.push(this); }
        decode() { return Promise.resolve(); }
      },
      document: { activeElement: null, querySelector: () => null },
      ResizeObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    };
    const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, globals);
    let cleanup;
    t.after(() => {
      cleanup?.();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });

    cleanup = mountBackground(container);
    assert.equal(images.length, 2, 'default scene loads only flowers');
    await Promise.all(images.map(image => image.onload()));
    const status = container.querySelector('.garden-status');
    const retry = container.querySelector('.garden-status button');
    assert.equal(status.hidden, true);

    cleanup.update({ showCharacters: true });
    assert.equal(images.length, 3, 'Garden starts the character load');
    if (state === 'error') images[2].onerror();
    assert.equal(status.hidden, false, 'Garden exposes relevant loading/error state');

    cleanup.update();
    assert.equal(status.hidden, true, 'default tab hides character-only status');
    assert.equal(retry.hidden, true);
    if (state === 'loading') {
      images[2].onerror();
      assert.equal(status.hidden, true, 'late character failure remains irrelevant');
    }
    retry.dispatchEvent(new Event('click'));
    assert.equal(images.length, 3, 'default retry does not reload hidden characters');

    cleanup.update({ showCharacters: true });
    assert.equal(status.hidden, false, 'returning to Garden exposes the character failure');
    assert.equal(retry.hidden, false);
    retry.dispatchEvent(new Event('click'));
    assert.equal(images.length, 4, 'Garden can retry the character failure');
    await images[3].onload();
    assert.equal(status.hidden, true);
  });
}
