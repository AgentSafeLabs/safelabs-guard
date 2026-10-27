// Muse Spark: reasons over the current PackProof step and claims what it sees.
// Its output is advisory only and never writes to the ledger.

export interface SparkInput {
  orderId: string;
  step: string;
  /** Frame reference (URL or data URI). */
  frame?: string;
  transcript?: string;
  /** Mock-only: claim to return instead of the default. */
  mockClaim?: SparkClaim;
}

export interface SparkClaim {
  /** Object labels Spark says are in the frame. */
  objects: string[];
  /** Action Spark proposes next, e.g. "SEAL_BOX". */
  proposedAction: string;
  rationale: string;
}

export interface SparkClient {
  readonly mode: "live" | "mock";
  reason(input: SparkInput): Promise<SparkClaim>;
}

export class MockSparkClient implements SparkClient {
  readonly mode = "mock" as const;

  async reason(input: SparkInput): Promise<SparkClaim> {
    if (input.mockClaim) return input.mockClaim;
    return {
      objects: ["red mug", "blue notebook", "usb-c cable"],
      proposedAction: input.step,
      rationale: "Mock: all expected items visible.",
    };
  }
}

class LiveSparkClient implements SparkClient {
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async reason(): Promise<SparkClaim> {
    void this.apiKey;
    throw new Error("Muse Spark live client not implemented");
  }
}

export function getSparkClient(): SparkClient {
  const key = process.env.META_SPARK_API_KEY;
  if (!key || process.env.SAFELABS_USE_MOCKS === "true") {
    return new MockSparkClient();
  }
  return new LiveSparkClient(key);
}
