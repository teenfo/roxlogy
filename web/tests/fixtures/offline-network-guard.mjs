// Loaded only by the offline QA child process. External requests are rejected BEFORE fetch.
// No production code imports this module or changes authentication behavior.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1' || url.port !== '54321' || url.protocol !== 'http:') {
    throw new Error('OFFLINE_QA_NETWORK_BLOCKED');
  }
  return nativeFetch(input, { ...init, redirect: 'error' });
};
