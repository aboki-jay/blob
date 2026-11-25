// Where the fixture pages are served during browser tests and screenshots.
// An unusual port, so an unrelated local server is unlikely to be sitting on it.
export const PORT = 43117;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = `http://${HOST}`;
/** Only Blob's fixture server answers this path, which is how the tests recognise it. */
export const HEALTH = `${ORIGIN}/__blob-fixtures`;
