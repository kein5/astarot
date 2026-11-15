// A sample file location for a path field's placeholder, written the way this OS writes paths
// (the app runs on Windows and Linux). It is only an example; nothing reads it.
export const pathExample = (file, agent = globalThis.navigator?.userAgent ?? "") =>
    /Windows/.test(agent) ? `C:\\models\\${file}` : `/home/user/models/${file}`;
