import { createHash } from "node:crypto";
import { canonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import type { V3InnerRecord, V3Record, V3RecordSource } from "./record.js";

/**
 * 按嘉立创 EDA V3 最终一致性规则选择完整原子记录：
 * 同文档、type、id 下 ticket 较大者胜出；ticket 相同时 client 较小者胜出。
 * 这里不会把两个内层对象按字段合并，因为官方规则选择的是整条原子记录。
 */
export interface V3DocumentContext {
  readonly uuid: string;
  readonly docType: string;
  readonly client: string;
}

export interface ReducedV3Record {
  readonly record: V3Record;
  readonly client: string;
  readonly source: V3RecordSource;
  readonly sourceBytes: number;
}

interface ReducedV3Document {
  readonly uuid: string;
  readonly docType: string;
  readonly clients: Set<string>;
  readonly headers: V3DocumentHeader[];
  readonly records: Map<string, ReducedV3Record>;
}

export interface V3DocumentHeader {
  readonly client: string;
  readonly source: V3RecordSource;
}

export interface ReducedV3DocumentSnapshot {
  readonly uuid: string;
  readonly docType: string;
  readonly clients: readonly string[];
  readonly headers: readonly V3DocumentHeader[];
  readonly deleted: boolean;
  readonly records: readonly ReducedV3Record[];
}

export interface V3ReductionSummary {
  readonly documentHeaders: number;
  readonly documents: number;
  readonly activeDocuments: number;
  readonly deletedDocuments: number;
  readonly inputRecords: number;
  readonly inputTombstones: number;
  readonly selectedRecords: number;
  readonly activeRecords: number;
  readonly tombstoneRecords: number;
  readonly retainedSourceBytes: number;
  readonly replacedByHigherTicket: number;
  readonly replacedByClientTieBreak: number;
  readonly ignoredOlderTicket: number;
  readonly ignoredByClientTieBreak: number;
  readonly identicalDuplicates: number;
  readonly selectedRecordTypes: Readonly<Record<string, number>>;
  readonly activeRecordTypes: Readonly<Record<string, number>>;
  readonly stateSha256: string;
}

export interface V3ReducerLimits {
  readonly maxReducedRecords: number;
  readonly maxReducedSourceBytes: number;
}

interface ReducerCounters {
  documentHeaders: number;
  inputRecords: number;
  inputTombstones: number;
  retainedSourceBytes: number;
  replacedByHigherTicket: number;
  replacedByClientTieBreak: number;
  ignoredOlderTicket: number;
  ignoredByClientTieBreak: number;
  identicalDuplicates: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedCountRecord(
  values: ReadonlyMap<string, number>
): Readonly<Record<string, number>> {
  return Object.fromEntries([...values.entries()].sort(([left], [right]) => compareText(left, right)));
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function recordKey(type: string, id: string | undefined): string {
  return JSON.stringify(id === undefined ? [type, 0] : [type, 1, id]);
}

function isSafeTicket(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isObject(value: V3InnerRecord): value is Readonly<Record<string, unknown>> {
  return value !== "";
}

function isDocumentDeleted(document: ReducedV3Document): boolean {
  const deleteRecord = document.records.get(recordKey("DELETE_DOC", undefined));
  return (
    deleteRecord !== undefined &&
    isObject(deleteRecord.record.inner) &&
    deleteRecord.record.inner.isDelete === true
  );
}

export class V3Reducer {
  readonly #limits: V3ReducerLimits;
  readonly #documents = new Map<string, ReducedV3Document>();
  readonly #counters: ReducerCounters = {
    documentHeaders: 0,
    inputRecords: 0,
    inputTombstones: 0,
    retainedSourceBytes: 0,
    replacedByHigherTicket: 0,
    replacedByClientTieBreak: 0,
    ignoredOlderTicket: 0,
    ignoredByClientTieBreak: 0,
    identicalDuplicates: 0
  };
  #selectedRecords = 0;

  public constructor(limits: V3ReducerLimits) {
    this.#limits = limits;
  }

  public enterDocument(record: V3Record, source: V3RecordSource): V3DocumentContext {
    if (
      record.outer.type !== "DOCHEAD" ||
      !isObject(record.inner) ||
      typeof record.inner.uuid !== "string" ||
      record.inner.uuid === "" ||
      typeof record.inner.docType !== "string" ||
      record.inner.docType === "" ||
      typeof record.inner.client !== "string" ||
      record.inner.client === ""
    ) {
      throw new AppError(
        ERROR_CODES.V3_INVALID_DOCHEAD,
        "DOCHEAD 必须包含非空 `uuid`、`docType` 和 `client`。",
        { source }
      );
    }

    this.#counters.documentHeaders += 1;
    const context = {
      uuid: record.inner.uuid,
      docType: record.inner.docType,
      client: record.inner.client
    };
    const existing = this.#documents.get(context.uuid);
    if (existing !== undefined) {
      if (existing.docType !== context.docType) {
        throw new AppError(
          ERROR_CODES.V3_DOCUMENT_TYPE_CONFLICT,
          "同一文档 UUID 出现冲突的文档类型。",
          {
            source,
            details: {
              existingDocumentType: existing.docType,
              incomingDocumentType: context.docType
            }
          }
        );
      }
      existing.clients.add(context.client);
      existing.headers.push({
        client: context.client,
        source
      });
    } else {
      this.#documents.set(context.uuid, {
        uuid: context.uuid,
        docType: context.docType,
        clients: new Set([context.client]),
        headers: [
          {
            client: context.client,
            source
          }
        ],
        records: new Map()
      });
    }

    return context;
  }

  public accept(
    context: V3DocumentContext,
    record: V3Record,
    source: V3RecordSource,
    sourceBytes: number
  ): void {
    if (record.outer.type === "DOCHEAD") {
      throw new AppError(
        ERROR_CODES.V3_INVALID_RECORD,
        "DOCHEAD 必须通过文档入口处理，不能作为普通记录归并。",
        { source }
      );
    }
    if (!isSafeTicket(record.outer.ticket)) {
      throw new AppError(
        ERROR_CODES.V3_INVALID_TICKET,
        "V3 普通记录必须包含非负安全整数 `ticket`。",
        { source }
      );
    }
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 0) {
      throw new AppError(
        ERROR_CODES.V3_INVALID_RECORD,
        "V3 记录源字节数必须是非负安全整数。",
        { source }
      );
    }
    if (
      record.outer.id !== undefined &&
      (typeof record.outer.id !== "string" || record.outer.id === "")
    ) {
      throw new AppError(
        ERROR_CODES.V3_INVALID_RECORD,
        "V3 记录的 `id` 若存在，必须是非空字符串。",
        { source }
      );
    }

    const document = this.#documents.get(context.uuid);
    if (
      document === undefined ||
      document.docType !== context.docType ||
      !document.clients.has(context.client)
    ) {
      throw new AppError(
        ERROR_CODES.V3_INVALID_DOCHEAD,
        "普通记录没有有效的 DOCHEAD 上下文。",
        { source }
      );
    }

    this.#counters.inputRecords += 1;
    if (record.inner === "") {
      this.#counters.inputTombstones += 1;
    }

    const key = recordKey(record.outer.type, record.outer.id);
    const existing = document.records.get(key);
    const incoming: ReducedV3Record = {
      record,
      client: context.client,
      source,
      sourceBytes
    };

    if (existing === undefined) {
      this.#ensureCapacity(1, sourceBytes, source);
      document.records.set(key, incoming);
      this.#selectedRecords += 1;
      this.#counters.retainedSourceBytes += sourceBytes;
      return;
    }

    const existingTicket = existing.record.outer.ticket;
    if (!isSafeTicket(existingTicket)) {
      throw new AppError(
        ERROR_CODES.V3_INVALID_TICKET,
        "归并器内部存在非法 ticket。",
        { source: existing.source }
      );
    }
    const incomingTicket = record.outer.ticket;
    if (incomingTicket > existingTicket) {
      this.#replace(document, key, existing, incoming, source);
      this.#counters.replacedByHigherTicket += 1;
      return;
    }
    if (incomingTicket < existingTicket) {
      this.#counters.ignoredOlderTicket += 1;
      return;
    }

    const clientOrder = compareText(context.client, existing.client);
    if (clientOrder < 0) {
      this.#replace(document, key, existing, incoming, source);
      this.#counters.replacedByClientTieBreak += 1;
      return;
    }
    if (clientOrder > 0) {
      this.#counters.ignoredByClientTieBreak += 1;
      return;
    }

    if (canonicalJson(record) === canonicalJson(existing.record)) {
      this.#counters.identicalDuplicates += 1;
      return;
    }

    throw new AppError(
      ERROR_CODES.V3_AMBIGUOUS_CONFLICT,
      "同一文档、类型、ID、ticket 和 client 出现不同内容，官方规则无法裁决。",
      {
        source,
        details: {
          previousSource: existing.source
        }
      }
    );
  }

  public getSelectedRecord(
    documentUuid: string,
    type: string,
    id?: string
  ): ReducedV3Record | undefined {
    return this.#documents.get(documentUuid)?.records.get(recordKey(type, id));
  }

  /**
   * 返回与内部 Map 解耦的确定性快照，供后续 EDA-IR 编译使用。
   * 快照保留墓碑和已删除文档，由调用方依据自己的事实边界显式处理。
   */
  public getSnapshot(): readonly ReducedV3DocumentSnapshot[] {
    return [...this.#documents.values()]
      .sort((left, right) => compareText(left.uuid, right.uuid))
      .map((document) => ({
        uuid: document.uuid,
        docType: document.docType,
        clients: [...document.clients].sort(compareText),
        headers: [...document.headers].sort((left, right) => {
          const clientOrder = compareText(left.client, right.client);
          if (clientOrder !== 0) {
            return clientOrder;
          }
          const entryOrder = compareText(left.source.entry, right.source.entry);
          return entryOrder !== 0 ? entryOrder : left.source.line - right.source.line;
        }),
        deleted: isDocumentDeleted(document),
        records: [...document.records.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, selected]) => selected)
      }));
  }

  public summarize(): V3ReductionSummary {
    let activeDocuments = 0;
    let deletedDocuments = 0;
    let activeRecords = 0;
    let tombstoneRecords = 0;
    const selectedRecordTypes = new Map<string, number>();
    const activeRecordTypes = new Map<string, number>();

    for (const document of this.#documents.values()) {
      if (isDocumentDeleted(document)) {
        deletedDocuments += 1;
      } else {
        activeDocuments += 1;
      }
      for (const selected of document.records.values()) {
        increment(selectedRecordTypes, selected.record.outer.type);
        if (selected.record.inner === "") {
          tombstoneRecords += 1;
        } else {
          activeRecords += 1;
          increment(activeRecordTypes, selected.record.outer.type);
        }
      }
    }

    return {
      documentHeaders: this.#counters.documentHeaders,
      documents: this.#documents.size,
      activeDocuments,
      deletedDocuments,
      inputRecords: this.#counters.inputRecords,
      inputTombstones: this.#counters.inputTombstones,
      selectedRecords: this.#selectedRecords,
      activeRecords,
      tombstoneRecords,
      retainedSourceBytes: this.#counters.retainedSourceBytes,
      replacedByHigherTicket: this.#counters.replacedByHigherTicket,
      replacedByClientTieBreak: this.#counters.replacedByClientTieBreak,
      ignoredOlderTicket: this.#counters.ignoredOlderTicket,
      ignoredByClientTieBreak: this.#counters.ignoredByClientTieBreak,
      identicalDuplicates: this.#counters.identicalDuplicates,
      selectedRecordTypes: sortedCountRecord(selectedRecordTypes),
      activeRecordTypes: sortedCountRecord(activeRecordTypes),
      stateSha256: this.#stateSha256()
    };
  }

  #ensureCapacity(additionalRecords: number, additionalBytes: number, source: V3RecordSource): void {
    if (this.#selectedRecords + additionalRecords > this.#limits.maxReducedRecords) {
      throw new AppError(
        ERROR_CODES.V3_REDUCED_STATE_LIMIT_EXCEEDED,
        "V3 归并后的记录数超过安全限额。",
        {
          source,
          details: {
            maxReducedRecords: this.#limits.maxReducedRecords
          }
        }
      );
    }
    if (
      this.#counters.retainedSourceBytes + additionalBytes >
      this.#limits.maxReducedSourceBytes
    ) {
      throw new AppError(
        ERROR_CODES.V3_REDUCED_STATE_LIMIT_EXCEEDED,
        "V3 归并后的源数据大小超过安全限额。",
        {
          source,
          details: {
            maxReducedSourceBytes: this.#limits.maxReducedSourceBytes
          }
        }
      );
    }
  }

  #replace(
    document: ReducedV3Document,
    key: string,
    existing: ReducedV3Record,
    incoming: ReducedV3Record,
    source: V3RecordSource
  ): void {
    const deltaBytes = incoming.sourceBytes - existing.sourceBytes;
    this.#ensureCapacity(0, deltaBytes, source);
    document.records.set(key, incoming);
    this.#counters.retainedSourceBytes += deltaBytes;
  }

  #stateSha256(): string {
    const hash = createHash("sha256");
    hash.update("easyeda-v3-reduced-state-v1\n");
    const documents = [...this.#documents.values()].sort((left, right) =>
      compareText(left.uuid, right.uuid)
    );
    for (const document of documents) {
      hash.update(canonicalJson({ uuid: document.uuid, docType: document.docType }));
      hash.update("\n");
      const records = [...document.records.entries()].sort(([left], [right]) =>
        compareText(left, right)
      );
      for (const [, selected] of records) {
        hash.update(
          canonicalJson({
            client: selected.client,
            outer: selected.record.outer,
            inner: selected.record.inner
          })
        );
        hash.update("\n");
      }
    }
    return hash.digest("hex");
  }
}
