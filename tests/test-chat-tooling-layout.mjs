#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const toolingSource = readFileSync(join(repoRoot, 'static/chat/tooling.js'), 'utf8');
const responsiveSource = toolingSource.split('// ---- Thinking toggle / effort select ----')[0];

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) {
      tokens.forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => values.delete(token));
    },
    toggle(token, force) {
      if (typeof force === 'boolean') {
        if (force) values.add(token);
        else values.delete(token);
        return force;
      }
      if (values.has(token)) {
        values.delete(token);
        return false;
      }
      values.add(token);
      return true;
    },
    contains(token) {
      return values.has(token);
    },
  };
}

function createMatchMedia(initialMatch) {
  const listeners = [];
  return {
    matches: initialMatch,
    addEventListener(type, listener) {
      if (type === 'change') listeners.push(listener);
    },
    dispatch(nextMatch) {
      this.matches = nextMatch;
      for (const listener of listeners) listener({ matches: nextMatch });
    },
  };
}

function createContext({
  isDesktop = false,
  innerHeight = 812,
  visualHeight = 812,
  visualOffsetTop = 0,
} = {}) {
  const documentElementStyle = new Map();
  const documentElement = {
    clientHeight: innerHeight,
    style: {
      setProperty(name, value) {
        documentElementStyle.set(name, value);
      },
    },
    classList: makeClassList(),
  };
  const body = {
    classList: makeClassList(),
  };
  const resizeListeners = [];
  const viewportResizeListeners = [];
  const viewportScrollListeners = [];
  const mq = createMatchMedia(isDesktop);
  const focusCalls = [];
  const msgInput = {
    focus(options) {
      focusCalls.push(options ?? null);
    },
  };
  const context = {
    console,
    isDesktop,
    sidebarCollapsed: false,
    sidebarOverlay: {
      classList: makeClassList(),
    },
    msgInput,
    document: {
      documentElement,
      body,
    },
    window: {
      innerHeight,
      addEventListener(type, listener) {
        if (type === 'resize') resizeListeners.push(listener);
      },
      matchMedia() {
        return mq;
      },
      visualViewport: {
        get height() {
          return visualHeight;
        },
        get offsetTop() {
          return visualOffsetTop;
        },
        addEventListener(type, listener) {
          if (type === 'resize') viewportResizeListeners.push(listener);
          if (type === 'scroll') viewportScrollListeners.push(listener);
        },
      },
    },
  };
  context.globalThis = context;
  return {
    context,
    documentElementStyle,
    body,
    documentElement,
    mq,
    resizeListeners,
    viewportResizeListeners,
    viewportScrollListeners,
    focusCalls,
    setViewport(nextHeight, nextOffsetTop = visualOffsetTop) {
      visualHeight = nextHeight;
      visualOffsetTop = nextOffsetTop;
    },
    setInnerHeight(nextHeight) {
      innerHeight = nextHeight;
      context.window.innerHeight = nextHeight;
      documentElement.clientHeight = nextHeight;
    },
  };
}

const mobileHarness = createContext({
  isDesktop: false,
  innerHeight: 812,
  visualHeight: 812,
  visualOffsetTop: 0,
});
vm.runInNewContext(responsiveSource, mobileHarness.context, { filename: 'static/chat/tooling.js' });

mobileHarness.context.syncViewportHeight();
assert.equal(mobileHarness.documentElementStyle.get('--app-height'), '812px', 'app shell should track the visual viewport height');
assert.equal(mobileHarness.documentElementStyle.get('--app-top-offset'), '0px', 'app shell should default to a zero viewport offset');
assert.equal(mobileHarness.documentElementStyle.get('--keyboard-inset-height'), '0px', 'keyboard inset should default to zero when the viewport is fully open');
assert.equal(mobileHarness.body.classList.contains('keyboard-open'), false, 'keyboard-open should stay off when no keyboard inset exists');

mobileHarness.setViewport(498, 0);
mobileHarness.context.syncViewportHeight();
assert.equal(mobileHarness.documentElementStyle.get('--app-height'), '498px', 'app shell should shrink with the keyboard-aware visual viewport');
assert.equal(mobileHarness.documentElementStyle.get('--keyboard-inset-height'), '314px', 'keyboard inset should be derived from layout minus visual viewport height');
assert.equal(mobileHarness.body.classList.contains('keyboard-open'), true, 'mobile shells should enter keyboard-open mode when the keyboard consumes meaningful space');

mobileHarness.setViewport(700, 32);
mobileHarness.context.syncViewportHeight();
assert.equal(mobileHarness.documentElementStyle.get('--app-top-offset'), '32px', 'app shell should track visual viewport top offset changes');
assert.equal(mobileHarness.documentElementStyle.get('--keyboard-inset-height'), '80px', 'keyboard inset should subtract viewport top offset from the occupied area');
assert.equal(mobileHarness.body.classList.contains('keyboard-open'), false, 'small viewport shifts should not be treated as a keyboard-open state');

assert.equal(mobileHarness.context.focusComposer(), false, 'mobile session attachment should no longer auto-focus the composer by default');
assert.deepEqual(mobileHarness.focusCalls, [], 'mobile default focus policy should not trigger the keyboard implicitly');
assert.equal(mobileHarness.context.focusComposer({ force: true, preventScroll: true }), true, 'forced focus should still be available when the app needs user recovery input');
assert.equal(mobileHarness.focusCalls.length, 1, 'forced focus should invoke the composer exactly once');
assert.equal(mobileHarness.focusCalls[0]?.preventScroll, true, 'forced focus should request preventScroll for a steadier mobile viewport');

const desktopHarness = createContext({
  isDesktop: true,
  innerHeight: 900,
  visualHeight: 900,
  visualOffsetTop: 0,
});
vm.runInNewContext(responsiveSource, desktopHarness.context, { filename: 'static/chat/tooling.js' });
desktopHarness.context.initResponsiveLayout();

assert.equal(desktopHarness.resizeListeners.length, 1, 'layout init should watch window resize');
assert.equal(desktopHarness.viewportResizeListeners.length, 1, 'layout init should watch visual viewport resize');
assert.equal(desktopHarness.viewportScrollListeners.length, 1, 'layout init should watch visual viewport scroll for mobile browser UI changes');
assert.equal(desktopHarness.context.focusComposer({ preventScroll: true }), true, 'desktop session attachment should still auto-focus the composer');
assert.equal(desktopHarness.focusCalls.length, 1, 'desktop focus should invoke the composer exactly once');
assert.equal(desktopHarness.focusCalls[0]?.preventScroll, true, 'desktop focus should pass through preventScroll when requested');

desktopHarness.body.classList.add('keyboard-open');
desktopHarness.mq.dispatch(true);
assert.equal(desktopHarness.body.classList.contains('keyboard-open'), false, 'desktop breakpoint changes should clear any stale mobile keyboard state');
