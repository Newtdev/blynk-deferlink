import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { writeClipboardReferral } from './clipboardHandoff.js';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDateNow = Date.now;
const originalConsoleWarn = console.warn;

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    delete (globalThis as { navigator?: Navigator }).navigator;
  }
  Date.now = originalDateNow;
  console.warn = originalConsoleWarn;
});

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
}

test('does nothing when the clipboard API is unavailable', async () => {
  setNavigator(undefined);
  await assert.doesNotReject(writeClipboardReferral('NO_NAVIGATOR'));

  setNavigator({});
  await assert.doesNotReject(writeClipboardReferral('NO_CLIPBOARD'));

  setNavigator({ clipboard: {} });
  await assert.doesNotReject(writeClipboardReferral('NO_WRITER'));
});

test('writes a versioned payload with the referral code and Unix timestamp', async () => {
  const writes: string[] = [];
  Date.now = () => 1_723_636_800_987;
  setNavigator({
    clipboard: {
      writeText: async (payload: string) => {
        writes.push(payload);
      },
    },
  });

  await writeClipboardReferral('SUMMER42');

  assert.deepEqual(writes, ['deferlink_ref:v1:SUMMER42:1723636800']);
});

test('appends the signed click token when one is available', async () => {
  const writes: string[] = [];
  Date.now = () => 1_723_636_800_000;
  setNavigator({
    clipboard: {
      writeText: async (payload: string) => {
        writes.push(payload);
      },
    },
  });

  await writeClipboardReferral('SUMMER42', 'signed.token');

  assert.deepEqual(writes, ['deferlink_ref:v1:SUMMER42:1723636800:signed.token']);
});

test('invokes writeText synchronously so a caller can preserve its user gesture', async () => {
  let called = false;
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  setNavigator({
    clipboard: {
      writeText: () => {
        called = true;
        return pendingWrite;
      },
    },
  });

  const handoff = writeClipboardReferral('GESTURE');

  assert.equal(called, true);
  releaseWrite();
  await handoff;
});

test('warns and resolves when the browser rejects the clipboard write', async () => {
  const failure = new Error('permission denied');
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  setNavigator({
    clipboard: {
      writeText: async () => {
        throw failure;
      },
    },
  });

  await assert.doesNotReject(writeClipboardReferral('FALLBACK'));

  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /falling back to fingerprint matching/);
  assert.equal(warnings[0][1], failure);
});
