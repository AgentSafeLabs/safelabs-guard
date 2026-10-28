// Browser mic -> 16 kHz mono WAV Blob. Uses an AudioWorklet when available,
// otherwise ScriptProcessorNode (deprecated, but still the only option on some
// older Safari builds). Capture stops itself at the 15 s limit.

import { assertMediaAvailable, MediaAccessError, toMediaError } from "./media-errors";
import { downsample, encodeWav, mergeChunks, MAX_DURATION_SECONDS, TARGET_SAMPLE_RATE } from "./wav";

// Copies channel 0 of each 128-frame block to the main thread.
const WORKLET_SOURCE = `
class PackProofCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("packproof-capture", PackProofCapture);
`;

interface Recording {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  node: AudioNode;
  sink: GainNode;
  chunks: Float32Array[];
  captured: number;
}

let active: Recording | null = null;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isRecording(): boolean {
  return active !== null;
}

export async function startRecording(): Promise<void> {
  if (active) return;
  const devices = assertMediaAvailable("microphone");
  const Ctor = audioContextCtor();
  if (!Ctor) throw new MediaAccessError("This browser cannot record audio.", "unsupported");

  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (err) {
    throw toMediaError(err, "microphone");
  }

  const context = new Ctor();
  await context.resume().catch(() => {});
  const source = context.createMediaStreamSource(stream);
  const maxSamples = Math.ceil(context.sampleRate * MAX_DURATION_SECONDS);
  const rec: Omit<Recording, "node"> & { node?: AudioNode } = {
    context,
    stream,
    source,
    sink: context.createGain(),
    chunks: [],
    captured: 0,
  };
  rec.sink.gain.value = 0; // keep the graph pulling without echoing to speakers
  const push = (data: Float32Array) => {
    if (rec.captured >= maxSamples) return;
    const room = maxSamples - rec.captured;
    const chunk = data.length > room ? data.slice(0, room) : data;
    rec.chunks.push(chunk);
    rec.captured += chunk.length;
  };

  let node: AudioNode;
  if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const worklet = new AudioWorkletNode(context, "packproof-capture", { numberOfInputs: 1, numberOfOutputs: 1 });
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => push(event.data);
    node = worklet;
  } else {
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => push(event.inputBuffer.getChannelData(0).slice(0));
    node = processor;
  }
  source.connect(node);
  node.connect(rec.sink);
  rec.sink.connect(context.destination);
  active = { ...rec, node };
}

/** Stops capture and returns a 16 kHz mono WAV, or null if nothing was recorded. */
export async function stopRecording(): Promise<Blob | null> {
  const rec = active;
  active = null;
  if (!rec) return null;
  try {
    rec.source.disconnect();
    rec.node.disconnect();
    rec.sink.disconnect();
  } catch {
    // already disconnected
  }
  rec.stream.getTracks().forEach((t) => t.stop());
  const rate = rec.context.sampleRate;
  await rec.context.close().catch(() => {});

  const merged = mergeChunks(rec.chunks);
  if (merged.length === 0) return null;
  const mono16k = rate === TARGET_SAMPLE_RATE ? merged : downsample(merged, rate, TARGET_SAMPLE_RATE);
  const wav = encodeWav(mono16k.subarray(0, TARGET_SAMPLE_RATE * MAX_DURATION_SECONDS), TARGET_SAMPLE_RATE);
  return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
}

/** Stops capture and throws the audio away. */
export async function discardRecording(): Promise<void> {
  await stopRecording();
}
