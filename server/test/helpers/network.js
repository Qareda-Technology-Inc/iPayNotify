/**
 * Tests never reach the network. Any fetch a test did not plan for throws, so a missed mock
 * cannot silently send an SMS or call Hubtel.
 */
const realFetch = globalThis.fetch;

/** Local HTTP calls to an express app started by the test itself. */
function isLocal(url) {
  return /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url));
}

export function blockUnexpectedFetch() {
  globalThis.fetch = async (url, opts) => {
    if (isLocal(url)) return realFetch(url, opts);
    throw new Error(`Unexpected network call in test: ${url}`);
  };
}

/**
 * Fake Hubtel Status Check. `state` is mutable so a test can change the answer mid-flow:
 *   mode: 'paid' | 'unpaid' | 'blocked' (403) | 'down' (network error); amountGhs: reported amount.
 * Returns the list of status-check URLs hit.
 */
export function fakeHubtelStatus(state) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    if (isLocal(url)) return realFetch(url, opts);
    if (String(url).startsWith('https://hubtel-status.test/')) {
      calls.push(String(url));
      if (state.mode === 'down') throw new Error('ECONNRESET');
      if (state.mode === 'blocked') return new Response('Forbidden', { status: 403 });
      const status = state.mode === 'paid' ? 'Paid' : 'Unpaid';
      return Response.json({
        responseCode: '0000',
        data: { status, amount: state.amountGhs, transactionId: state.transactionId || 'HUB-1' },
      });
    }
    throw new Error(`Unexpected network call in test: ${url}`);
  };
  return calls;
}
