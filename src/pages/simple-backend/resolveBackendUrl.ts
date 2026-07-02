export function resolveBackendUrl(configuredUrl?: string): string | undefined {
  if (configuredUrl === undefined) {
    return undefined;
  }

  // SAME_ORIGIN: the backend serves both the API and this built frontend, so
  // talk to whatever origin the page was loaded from. This keeps the hosted
  // deployment working even when the public (tunnel) URL changes, because
  // nothing about the origin is baked into the build.
  if (configuredUrl === "SAME_ORIGIN") {
    return trimTrailingSlash(window.location.origin);
  }

  if (configuredUrl !== "AUTO") {
    return configuredUrl;
  }

  const currentUrl = new URL(window.location.href);
  currentUrl.hash = "";
  currentUrl.search = "";

  if (currentUrl.port === "1234") {
    currentUrl.port = "8080";
    return trimTrailingSlash(currentUrl.toString());
  }

  const noHash = window.location.href.split("#")[0].split("?")[0];
  const replaced = noHash.replace(/([/:])1234(?=\/|$)/, "$18080");
  if (replaced !== noHash) {
    return trimTrailingSlash(replaced);
  }

  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
