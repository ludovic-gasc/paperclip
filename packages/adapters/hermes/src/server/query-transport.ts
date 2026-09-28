/**
 * Query transport for `hermes chat`, kept in one place so the argv layout is
 * validated instead of assembled ad hoc.
 *
 * The CLI's parser is strict about where the query sits. Its own usage line is:
 *
 *   usage: hermes chat [-h] [-q QUERY | --query-file PATH] [--oneshot] ...
 *
 * and `-q` and `--query-file` are mutually exclusive. A `--query-file` appended
 * at the end of the argv (after `--yolo`, or after an operator `--` separator)
 * is read as positional text, or rejected outright, and the run never starts.
 * Both transports are therefore only ever accepted in the query slot, and the
 * argv is asserted before it is handed to `spawn()`.
 */

/**
 * Largest query the adapter passes as a single argv entry.
 *
 * `MAX_ARG_STRLEN` is `32 * PAGE_SIZE`, so 131072 bytes on a 4 KiB-page kernel.
 * Measured on Linux 7.2.x / PAGE_SIZE 4096: 131071 bytes start, 131072 bytes
 * fail with `E2BIG`. This is a compile-time kernel constant, not a sysctl:
 * `RLIMIT_STACK` moves the total argv+env budget, never the per-string cap.
 */
export const HERMES_MAX_INLINE_QUERY_BYTES = 131072;

/** Query flags the CLI accepts, in the mutually exclusive query slot. */
export const HERMES_INLINE_QUERY_FLAGS = ["-q", "--query"] as const;
export const HERMES_QUERY_FILE_FLAG = "--query-file";

/**
 * True when the query can no longer travel as one argv entry.
 *
 * The comparison is on UTF-8 bytes, which is what the kernel counts: a query of
 * 40000 astral-plane characters is 160000 bytes and must take the file path
 * even though its JavaScript `length` is far below the limit.
 */
export function queryExceedsInlineLimit(query: string): boolean {
  return Buffer.byteLength(query, "utf8") >= HERMES_MAX_INLINE_QUERY_BYTES;
}

function isInlineQueryFlag(token: string | undefined): boolean {
  return token === "-q" || token === "--query";
}

/**
 * Move the query out of argv.
 *
 * Replaces the inline `-q <query>` entry with `--query-file <path>`. The
 * replacement is positional, not a `push()`: the query flag must stay in the
 * slot the CLI's parser expects. Throws rather than mangling an argv it does
 * not recognise, so a future refactor of the argument builder fails loudly
 * here instead of silently producing a command line `hermes chat` rejects.
 */
export function applyQueryFileTransport(
  args: readonly string[],
  queryFilePath: string,
): string[] {
  if (args[0] !== "chat") {
    throw new Error(
      `[hermes] Cannot move the query out of argv: expected the "chat" subcommand at argv[0], got ${JSON.stringify(args[0])}.`,
    );
  }
  if (!isInlineQueryFlag(args[1])) {
    throw new Error(
      `[hermes] Cannot move the query out of argv: expected an inline query flag at argv[1], got ${JSON.stringify(args[1])}.`,
    );
  }
  if (typeof args[2] !== "string" || args[2].length === 0) {
    throw new Error(
      "[hermes] Cannot move the query out of argv: the inline query flag has no value at argv[2].",
    );
  }
  if (typeof queryFilePath !== "string" || queryFilePath.length === 0) {
    throw new Error("[hermes] Cannot move the query out of argv: no query file path was provided.");
  }

  const next = [...args];
  next.splice(1, 2, HERMES_QUERY_FILE_FLAG, queryFilePath);
  return next;
}

/**
 * Assert the argv still matches what `hermes chat` parses.
 *
 * Called on every run, right before `spawn()`, and covered by tests for the
 * mis-placements that break the CLI. The rules are:
 *
 *  - `chat` is the subcommand at argv[0];
 *  - exactly one query transport sits in the query slot (argv[1]) with a
 *    non-empty value at argv[2];
 *  - a `--query-file` value is a path, never another flag (`-` is the CLI's
 *    stdin sentinel and is allowed);
 *  - no second query transport appears later in the argv;
 *  - the query slot is not hidden behind an operator `--` separator.
 */
export function assertHermesChatQueryTransport(args: readonly string[]): void {
  if (args.length < 3) {
    throw new Error(
      `[hermes] Refusing to start: "hermes chat" needs a query transport and a value, got ${args.length} argv entries.`,
    );
  }
  if (args[0] !== "chat") {
    throw new Error(
      `[hermes] Refusing to start: expected the "chat" subcommand at argv[0], got ${JSON.stringify(args[0])}.`,
    );
  }

  const flag = args[1];
  const value = args[2];
  const inlineFlag = isInlineQueryFlag(flag);
  const fileFlag = flag === HERMES_QUERY_FILE_FLAG;

  if (!inlineFlag && !fileFlag) {
    throw new Error(
      `[hermes] Refusing to start: expected ${HERMES_INLINE_QUERY_FLAGS.join("/")} or ${HERMES_QUERY_FILE_FLAG} in the query slot (argv[1]), got ${JSON.stringify(flag)}.`,
    );
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `[hermes] Refusing to start: ${String(flag)} has no value at argv[2].`,
    );
  }
  if (value.startsWith("-") && value !== "-") {
    throw new Error(
      `[hermes] Refusing to start: ${String(flag)} at argv[1] is followed by what looks like another flag (${JSON.stringify(value)}).`,
    );
  }

  for (let index = 3; index < args.length; index += 1) {
    const token = args[index];
    if (isInlineQueryFlag(token) || token === HERMES_QUERY_FILE_FLAG) {
      throw new Error(
        `[hermes] Refusing to start: a second query transport (${token}) appears at argv[${index}]; the CLI accepts one and treats the rest as positional text.`,
      );
    }
  }
}
