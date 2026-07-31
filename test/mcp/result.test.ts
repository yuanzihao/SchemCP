import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpResult,
  MCP_LIMITS
} from "../../src/mcp/server.js";

test("MCP 结构化结果超过硬上限时返回稳定错误且不回显大对象", () => {
  const result = createMcpResult({
    payload: "x".repeat(MCP_LIMITS.maxStructuredResultBytes)
  });

  assert.equal(result.isError, true);
  const structured = result.structuredContent as {
    readonly ok: boolean;
    readonly error: { readonly code: string };
  };
  assert.equal(structured.ok, false);
  assert.equal(structured.error.code, "MCP_TOOL_RESULT_TOO_LARGE");
  const text = result.content[0];
  assert.equal(text?.type, "text");
  if (text?.type === "text") {
    assert.ok(
      Buffer.byteLength(text.text, "utf8") <
        MCP_LIMITS.maxStructuredResultBytes
    );
    assert.equal(text.text.includes("xxxxxxxxxx"), false);
  }
});

test("MCP 结构化结果在上限内保持文本与 structuredContent 一致", () => {
  const result = createMcpResult({ value: 42 });

  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    readonly ok: boolean;
    readonly value: number;
    readonly platformSecurity: {
      readonly privatePermissionCapability: string;
    };
  };
  assert.equal(structured.ok, true);
  assert.equal(structured.value, 42);
  assert.equal(
    structured.platformSecurity.privatePermissionCapability,
    process.platform === "win32"
      ? "WINDOWS_ACL_NOT_VERIFIED"
      : "POSIX_MODE_ENFORCED"
  );
  const text = result.content[0];
  assert.equal(text?.type, "text");
  if (text?.type === "text") {
    assert.deepEqual(JSON.parse(text.text), result.structuredContent);
  }
});
