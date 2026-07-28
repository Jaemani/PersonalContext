import type { SetupApiClient, SetupDetection, SetupOptions, SetupResult } from "./types.js";

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const token =
    document
      .querySelector<HTMLMetaElement>('meta[name="personal-context-token"]')
      ?.content ?? "";
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-personal-context-token": token,
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`Setup request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Default wiring for the server routes expected by the setup application. */
export const sameOriginSetupClient: SetupApiClient = {
  detect: (signal) => json<SetupDetection>("/api/setup/detect", { signal }),
  connect: (options: SetupOptions, signal) =>
    json<SetupResult>("/api/setup/connect", { method: "POST", body: JSON.stringify(options), signal }),
  chooseFolder: (signal) =>
    json<SetupDetection>("/api/setup/choose-folder", {
      method: "POST",
      signal,
    }),
  finish: (signal) =>
    json<void>("/api/setup/finish", { method: "POST", signal }),
};
