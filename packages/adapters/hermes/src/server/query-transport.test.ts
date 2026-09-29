/**
 * Unit coverage for the query transport: the size threshold and the strict
 * argv checks that keep `hermes chat` able to parse the command line.
 *
 * `hermes chat` accepts one query transport, in its own query slot:
 *
 *   usage: hermes chat [-h] [-q QUERY | --query-file PATH] [--oneshot] ...
 *
 * A `--query-file` appended anywhere else is read as positional text, so the
 * misplaced forms below are asserted to be rejected rather than silently sent
 * to spawn().
 */

import { describe, expect, test } from "vitest";

import {
  HERMES_MAX_INLINE_QUERY_BYTES,
  HERMES_MAX_INLINE_QUERY_BYTES_LINUX,
  HERMES_MAX_INLINE_QUERY_BYTES_WINDOWS,
  applyQueryFileTransport,
  assertHermesChatQueryTransport,
  hermesInlineQueryLimit,
  queryExceedsInlineLimit,
} from "./query-transport.js";

describe("hermesInlineQueryLimit", () => {
  test("Linux keeps the per-entry MAX_ARG_STRLEN cap", () => {
    expect(hermesInlineQueryLimit("linux")).toBe(131072);
    expect(HERMES_MAX_INLINE_QUERY_BYTES_LINUX).toBe(131072);
  });

  test("Windows uses the whole-command-line budget, not the Linux per-entry cap", () => {
    // CreateProcess caps the whole command line at 32767 UTF-16 units, so a
    // 131072-byte entry can never be launched from there.
    expect(hermesInlineQueryLimit("win32")).toBe(HERMES_MAX_INLINE_QUERY_BYTES_WINDOWS);
    expect(HERMES_MAX_INLINE_QUERY_BYTES_WINDOWS).toBeLessThan(32767);
  });

  test("the exported limit is the limit of the host platform", () => {
    expect(HERMES_MAX_INLINE_QUERY_BYTES).toBe(hermesInlineQueryLimit(process.platform));
  });
});

describe("queryExceedsInlineLimit", () => {
  test("a query one byte under MAX_ARG_STRLEN stays in argv", () => {
    expect(queryExceedsInlineLimit("y".repeat(HERMES_MAX_INLINE_QUERY_BYTES - 1))).toBe(false);
  });

  test("a query of exactly MAX_ARG_STRLEN bytes leaves argv", () => {
    expect(queryExceedsInlineLimit("y".repeat(HERMES_MAX_INLINE_QUERY_BYTES))).toBe(true);
  });

  test("counts UTF-8 bytes, not UTF-16 code units", () => {
    // 40000 astral-plane characters are 160000 bytes but only 80000 JS units.
    const astral = "\u{1F600}".repeat(40000);
    expect(astral.length).toBe(80000);
    expect(queryExceedsInlineLimit(astral)).toBe(true);
  });

  test("an empty query is inline", () => {
    expect(queryExceedsInlineLimit("")).toBe(false);
  });
});

describe("applyQueryFileTransport", () => {
  test("replaces the query slot in place and keeps every other argument", () => {
    const args = ["chat", "-q", "hello", "-Q", "--source", "tool", "--yolo"];

    const next = applyQueryFileTransport(args, "/tmp/query.txt");

    expect(next).toEqual([
      "chat",
      "--query-file",
      "/tmp/query.txt",
      "-Q",
      "--source",
      "tool",
      "--yolo",
    ]);
    // The original array is not mutated: the caller owns the argv it built.
    expect(args[1]).toBe("-q");
  });

  test("accepts the long inline flag", () => {
    expect(applyQueryFileTransport(["chat", "--query", "hello", "--yolo"], "/tmp/q.txt")).toEqual([
      "chat",
      "--query-file",
      "/tmp/q.txt",
      "--yolo",
    ]);
  });

  test("refuses an argv whose query slot it does not recognise", () => {
    expect(() => applyQueryFileTransport(["chat", "-Q", "hello"], "/tmp/q.txt")).toThrow(
      /query flag at argv\[1\]/,
    );
    expect(() => applyQueryFileTransport(["run", "-q", "hello"], "/tmp/q.txt")).toThrow(
      /"chat" subcommand/,
    );
    expect(() => applyQueryFileTransport(["chat", "-q", ""], "/tmp/q.txt")).toThrow(
      /no value at argv\[2\]/,
    );
    expect(() => applyQueryFileTransport(["chat", "-q", "hello"], "")).toThrow(
      /no query file path/,
    );
  });
});

describe("assertHermesChatQueryTransport", () => {
  test("accepts the inline transport the adapter builds by default", () => {
    expect(() =>
      assertHermesChatQueryTransport(["chat", "-q", "hello", "-Q", "--yolo"]),
    ).not.toThrow();
  });

  test("accepts the file transport in the query slot", () => {
    expect(() =>
      assertHermesChatQueryTransport(["chat", "--query-file", "/tmp/q.txt", "--yolo"]),
    ).not.toThrow();
    // '-' is the CLI's stdin sentinel, not a flag.
    expect(() =>
      assertHermesChatQueryTransport(["chat", "--query-file", "-", "--yolo"]),
    ).not.toThrow();
  });

  test("rejects a --query-file appended after the flags", () => {
    // This is the mis-placement the CLI cannot parse: the query option ends up
    // after `--yolo` and is read as positional text.
    expect(() =>
      assertHermesChatQueryTransport([
        "chat",
        "-q",
        "hello",
        "-Q",
        "--yolo",
        "--query-file",
        "/tmp/q.txt",
      ]),
    ).toThrow(/second query transport \(--query-file\) appears at argv\[5\]/);
  });

  test("rejects a --query-file hidden behind an operator -- separator", () => {
    expect(() =>
      assertHermesChatQueryTransport(["chat", "--", "-q", "hello"]),
    ).toThrow(/query slot \(argv\[1\]\)/);
  });

  test("rejects both transports at once", () => {
    expect(() =>
      assertHermesChatQueryTransport(["chat", "--query-file", "/tmp/q.txt", "-q", "hello"]),
    ).toThrow(/second query transport \(-q\)/);
  });

  test("rejects a missing or flag-shaped value", () => {
    expect(() => assertHermesChatQueryTransport(["chat", "--query-file"])).toThrow(
      /needs a query transport and a value/,
    );
    expect(() => assertHermesChatQueryTransport(["chat", "--query-file", "--yolo"])).toThrow(
      /looks like another flag/,
    );
    expect(() => assertHermesChatQueryTransport(["chat", "-q", ""])).toThrow(
      /has no value at argv\[2\]/,
    );
  });

  test("rejects an argv without the chat subcommand", () => {
    expect(() => assertHermesChatQueryTransport(["run", "-q", "hello"])).toThrow(
      /"chat" subcommand at argv\[0\]/,
    );
  });
});
