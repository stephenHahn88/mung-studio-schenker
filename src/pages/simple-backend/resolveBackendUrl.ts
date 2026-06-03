export function resolveBackendUrl(configuredUrl?: string): string | undefined {
  if (configuredUrl === undefined) {
    return undefined;
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
