export async function api<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        "request timed out — the workspace may be busy or offline",
      );
    }
    throw err;
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    throw new Error(err);
  }
  return body as T;
}

export function toolResult(
  data: unknown,
  image?: { mimeType: string; data: string },
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
  > = [{ type: "text", text: JSON.stringify(data, null, 2) }];
  if (image) {
    content.unshift({
      type: "image",
      mimeType: image.mimeType,
      data: image.data,
    });
  }
  return { content };
}
