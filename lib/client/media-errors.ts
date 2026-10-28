// Plain-language messages for getUserMedia failures (camera and mic).

export class MediaAccessError extends Error {
  constructor(
    message: string,
    readonly kind: "insecure" | "unsupported" | "denied" | "no-device" | "busy" | "unknown",
  ) {
    super(message);
    this.name = "MediaAccessError";
  }
}

export function assertMediaAvailable(device: "camera" | "microphone"): MediaDevices {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new MediaAccessError(
      `The ${device} only works over HTTPS (or on localhost). Open this page with https://.`,
      "insecure",
    );
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MediaAccessError(`This browser cannot use the ${device}.`, "unsupported");
  }
  return navigator.mediaDevices;
}

export function toMediaError(err: unknown, device: "camera" | "microphone"): MediaAccessError {
  if (err instanceof MediaAccessError) return err;
  const name = err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException)
    ? (err as Error).name
    : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return new MediaAccessError(
        `${device === "camera" ? "Camera" : "Microphone"} permission was denied. Allow it in the browser's site settings and try again.`,
        "denied",
      );
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return new MediaAccessError(`No ${device} was found on this device.`, "no-device");
    case "NotReadableError":
    case "TrackStartError":
      return new MediaAccessError(`The ${device} is in use by another app or tab.`, "busy");
    case "SecurityError":
      return new MediaAccessError(`The ${device} is blocked on this page (HTTPS is required).`, "insecure");
    default:
      return new MediaAccessError(`Could not start the ${device}.`, "unknown");
  }
}
