// Reads a request body with a hard byte cap, so an oversized upload is
// rejected without buffering it all. Content-Length is checked first when
// present; the stream is counted either way (the header can lie or be absent).

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Stop reading; the runtime drops the rest. Not reader.cancel(): on a
      // FormData-backed stream Node's undici then enqueues into a closed
      // stream and raises an unhandled rejection.
      reader.releaseLock();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Parses multipart/form-data from bytes already read with readBodyLimited(). */
export function formDataFrom(bytes: Uint8Array, contentType: string | null): Promise<FormData> {
  return new Response(bytes as unknown as BodyInit, { headers: { "content-type": contentType ?? "" } }).formData();
}
