/**
 * Tests for parseBobStreamOutput and isBobLimitError.
 */

import { describe, it, expect } from "vitest";
import { parseBobStreamOutput, isBobLimitError } from "./execute.js";

// ---------------------------------------------------------------------------
// parseBobStreamOutput
// ---------------------------------------------------------------------------

describe("parseBobStreamOutput", () => {
  it("extracts task_id, token stats and last_message from result event", () => {
    const stdout = [
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: "I will analyze the project.",
      }),
      JSON.stringify({
        type: "result",
        status: "success",
        stats: {
          task_id: "abc-123-def",
          total_tokens: 500,
          input_tokens: 300,
          output_tokens: 200,
          cache_read_tokens: 50,
          session_costs: 0.02,
          duration_ms: 12345,
          tool_calls: 3,
        },
        last_message: "Analysis complete.",
      }),
    ].join("\n");

    const result = parseBobStreamOutput(stdout);
    expect(result.taskId).toBe("abc-123-def");
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(200);
    expect(result.cachedInputTokens).toBe(50);
    expect(result.costUsd).toBe(0.02);
    expect(result.lastMessage).toBe("Analysis complete.");
    expect(result.status).toBe("success");
    expect(result.errorMessage).toBeUndefined();
  });

  it("captures error message from error event", () => {
    const stdout = [
      JSON.stringify({
        type: "error",
        severity: "cost",
        message: "Maximum cost limit reached",
      }),
      JSON.stringify({
        type: "result",
        status: "error",
        stats: { task_id: "xyz-789" },
        last_message: "Run stopped.",
      }),
    ].join("\n");

    const result = parseBobStreamOutput(stdout);
    expect(result.errorMessage).toBe("Maximum cost limit reached");
    expect(result.status).toBe("error");
    expect(result.taskId).toBe("xyz-789");
  });

  it("returns empty result for empty stdout", () => {
    const result = parseBobStreamOutput("");
    expect(result.taskId).toBeUndefined();
    expect(result.inputTokens).toBeUndefined();
    expect(result.status).toBeUndefined();
  });

  it("ignores non-JSON lines", () => {
    const stdout = [
      "Some plain text output",
      "Another plain line",
      JSON.stringify({
        type: "result",
        status: "success",
        stats: { task_id: "t1", total_tokens: 100, input_tokens: 60, output_tokens: 40 },
        last_message: "Done.",
      }),
    ].join("\n");

    const result = parseBobStreamOutput(stdout);
    expect(result.taskId).toBe("t1");
    expect(result.status).toBe("success");
  });

  it("fills errorMessage from last_message when result status is error and no prior error event", () => {
    const stdout = JSON.stringify({
      type: "result",
      status: "error",
      stats: {},
      last_message: "Something went wrong",
    });

    const result = parseBobStreamOutput(stdout);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Something went wrong");
  });
});

// ---------------------------------------------------------------------------
// isBobLimitError
// ---------------------------------------------------------------------------

describe("isBobLimitError", () => {
  it("detects cost severity error", () => {
    expect(
      isBobLimitError(
        JSON.stringify({ type: "error", severity: "cost", message: "limit" }),
      ),
    ).toBe(true);
  });

  it("detects turns severity error", () => {
    expect(
      isBobLimitError(
        JSON.stringify({ type: "error", severity: "turns", message: "limit" }),
      ),
    ).toBe(true);
  });

  it("detects --max-cost text in output", () => {
    expect(isBobLimitError("Exceeded --max-cost budget")).toBe(true);
  });

  it("returns false for normal success output", () => {
    expect(
      isBobLimitError(
        JSON.stringify({
          type: "result",
          status: "success",
          stats: { task_id: "t1" },
        }),
      ),
    ).toBe(false);
  });
});
