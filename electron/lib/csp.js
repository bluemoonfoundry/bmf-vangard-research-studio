/**
 * Builds the Content-Security-Policy applied to every renderer response.
 *
 * The renderer gets no direct network access (`connect-src 'self'`): anything
 * that talks to the outside world -- notably the opt-in LLM providers -- runs
 * in the main process, so API keys never reach renderer memory and an XSS in
 * user/LLM-authored content can't exfiltrate data. Images, fonts and media are
 * likewise local-only; remote assets are imported into the project instead.
 * Imported assets are streamed over the vrs-asset: scheme (assetProtocol.js).
 */
export function buildContentSecurityPolicy() {
    return [
        "default-src 'self'",
        "script-src 'self'",
        // React and Tailwind emit inline style attributes.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: vrs-asset:",
        "media-src 'self' blob: vrs-asset:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
    ].join('; ');
}

/** Installs the CSP header on every response served to the given session. */
export function applyContentSecurityPolicy(session) {
    const csp = buildContentSecurityPolicy();
    session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [csp],
            },
        });
    });
}
