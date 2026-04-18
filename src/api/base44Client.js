import { createClient } from "@base44/sdk";
import { appParams } from "@/lib/app-params";

const { appId, functionsVersion, appBaseUrl } = appParams;

function getLatestAccessToken() {
  if (typeof window === "undefined") {
    return appParams.token || null;
  }

  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("access_token");

  if (tokenFromUrl) {
    window.localStorage.setItem("base44_access_token", tokenFromUrl);
    window.localStorage.setItem("token", tokenFromUrl);

    params.delete("access_token");
    const nextUrl = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }${window.location.hash}`;

    window.history.replaceState({}, document.title, nextUrl);
    return tokenFromUrl;
  }

  return (
    window.localStorage.getItem("base44_access_token") ||
    window.localStorage.getItem("token") ||
    appParams.token ||
    null
  );
}

function createFreshClient() {
  return createClient({
    appId,
    token: getLatestAccessToken(),
    functionsVersion,
    serverUrl: "",
    requiresAuth: false,
    appBaseUrl,
  });
}

function createDeepProxy(targetFactory) {
  return new Proxy(
    {},
    {
      get(_, prop) {
        const target = targetFactory();
        const value = target[prop];

        if (typeof value === "function") {
          return value.bind(target);
        }

        if (value && typeof value === "object") {
          return createDeepProxy(() => targetFactory()[prop]);
        }

        return value;
      },
    }
  );
}

export const base44 = createDeepProxy(() => createFreshClient());