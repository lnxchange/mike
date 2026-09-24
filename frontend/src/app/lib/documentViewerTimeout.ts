export const DOCUMENT_FETCH_TIMEOUT_MS = 30_000;
export const DOCUMENT_RENDER_TIMEOUT_MS = 45_000;

export const DOCUMENT_LOAD_FAILED_MESSAGE =
    "This document could not be loaded. Please try again.";
export const DOCUMENT_LOAD_TIMEOUT_MESSAGE =
    "This document is taking too long to open. Please try again.";

export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message = DOCUMENT_LOAD_TIMEOUT_MESSAGE,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
