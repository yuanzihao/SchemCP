export interface V3OuterRecord {
  readonly type: string;
  readonly id?: string;
  readonly ticket?: number;
  readonly firstTicket?: number;
  readonly [key: string]: unknown;
}

export type V3InnerRecord = Readonly<Record<string, unknown>> | "";

export interface V3Record {
  readonly outer: V3OuterRecord;
  readonly inner: V3InnerRecord;
}

export interface V3RecordSource {
  readonly entry: string;
  readonly line: number;
}

export const V3_QUARANTINED_RECORD_STATE_FIELD =
  "__schemcpQuarantinedRecordState";

export const V3_QUARANTINED_MALFORMED_TEXT_STATE =
  "MALFORMED_TEXT_INNER_JSON";

export type V3QuarantinedTextInnerRecord = Readonly<{
  readonly [V3_QUARANTINED_RECORD_STATE_FIELD]: typeof V3_QUARANTINED_MALFORMED_TEXT_STATE;
}>;

export function isQuarantinedMalformedTextInner(
  value: V3InnerRecord | undefined
): value is V3QuarantinedTextInnerRecord {
  return (
    value !== undefined &&
    value !== "" &&
    value[V3_QUARANTINED_RECORD_STATE_FIELD] ===
      V3_QUARANTINED_MALFORMED_TEXT_STATE
  );
}
