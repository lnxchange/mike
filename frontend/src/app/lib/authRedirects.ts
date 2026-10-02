const AUTH_REDIRECT_PATHS = new Set([
    "/assistant",
    "/login",
    "/reset-password",
    "/settings",
    "/onboarding/profile",
    "/onboarding/practice",
]);

export function safeAuthNext(
    candidate: string | null | undefined,
    fallback = "/assistant",
): string {
    if (
        !candidate ||
        !candidate.startsWith("/") ||
        candidate.startsWith("//")
    ) {
        return fallback;
    }
    if (candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) {
        return fallback;
    }

    const base = new URL("https://auth.mike.local");
    const resolved = new URL(candidate, base);
    if (
        resolved.origin !== base.origin ||
        !AUTH_REDIRECT_PATHS.has(resolved.pathname)
    ) {
        return fallback;
    }
    return `${resolved.pathname}${resolved.search}`;
}

export function authCallbackUrl(origin: string, next: string): string {
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("next", safeAuthNext(next));
    return callback.toString();
}

export function browserAuthCallbackUrl(next: string): string | undefined {
    if (typeof window === "undefined") return undefined;
    return authCallbackUrl(window.location.origin, next);
}

const AUTH_HANDOFF_QUERY_KEYS = [
    "code",
    "next",
    "error",
    "error_code",
    "error_description",
] as const;

/**
 * If this URL still carries a GoTrue OAuth code or error, send it to the
 * callback page. Site URL landings (`/?code=`) otherwise lose the code on the
 * home redirect to `/assistant`.
 */
export function authCallbackPathFromSearch(
    search: string | URLSearchParams,
): string | null {
    const params =
        typeof search === "string"
            ? new URLSearchParams(
                  search.startsWith("?") ? search.slice(1) : search,
              )
            : new URLSearchParams(search);
    if (
        !params.get("code") &&
        !params.get("error") &&
        !params.get("error_description")
    ) {
        return null;
    }
    const forwarded = new URLSearchParams();
    for (const key of AUTH_HANDOFF_QUERY_KEYS) {
        const value = params.get(key);
        if (value) forwarded.set(key, value);
    }
    const query = forwarded.toString();
    return query ? `/auth/callback?${query}` : "/auth/callback";
}

export function homeRedirectPath(
    search: string | URLSearchParams,
): string {
    return authCallbackPathFromSearch(search) ?? "/assistant";
}

export function authErrorDescription(
    search: string,
    hash: string,
): string | null {
    const query = new URLSearchParams(search);
    const fragment = new URLSearchParams(hash.replace(/^#/, ""));
    const error = (
        query.get("error_description") ||
        query.get("error") ||
        fragment.get("error_description") ||
        fragment.get("error")
    );
    if (!error) return null;
    if (/expired|invalid/i.test(error)) {
        return "This confirmation link is invalid or has expired.";
    }
    if (/access.denied|cancel/i.test(error)) {
        return "Authentication was cancelled or denied.";
    }
    return "Authentication could not be completed. Please try again.";
}
