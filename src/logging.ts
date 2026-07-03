// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as process from "process";

export type LogMode = "grouped" | "normal" | "quiet";

export class ExecError {
  msg: string;
  exitCode: number;
  stderr: string;

  public constructor(msg: string, exitCode: number, stderr: string) {
    this.msg = msg;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }

  public toString(): string {
    return this.msg;
  }
}

export function getLogMode(): LogMode {
  const logMode = core.getInput("log-mode") || "grouped";
  if (logMode !== "grouped" && logMode !== "normal" && logMode !== "quiet") {
    throw new Error(
      `Invalid log-mode "${logMode}". Expected "grouped", "normal", or "quiet".`,
    );
  }
  return logMode;
}

export function logInfo(logMode: LogMode, message: string): void {
  if (logMode !== "quiet") {
    core.info(message);
  }
}

export function logDebug(logMode: LogMode, message: string): void {
  if (logMode !== "quiet") {
    core.debug(message);
  }
}

export async function withLogGroup<T>(
  logMode: LogMode,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (logMode !== "grouped") {
    return fn();
  }

  core.startGroup(name);
  try {
    return await fn();
  } finally {
    core.endGroup();
  }
}

export async function execCommand(
  commandLine: string,
  args?: string[],
  opts?: exec.ExecOptions & { label?: string; logMode?: LogMode },
): Promise<exec.ExecOutput> {
  const { label, logMode = "normal", ...execOpts } = opts || {};
  if (label) {
    logInfo(logMode, `▶️ ${label}`);
  }

  const silent = execOpts.silent || logMode === "quiet" || !core.isDebug();
  const out = await exec.getExecOutput(commandLine, args, {
    ...execOpts,
    silent,
    ignoreReturnCode: true,
  });
  if (out.exitCode !== 0) {
    if (silent) {
      process.stderr.write(out.stderr);
    }
    throw new ExecError(
      `${commandLine} failed with exit code ${out.exitCode}`,
      out.exitCode,
      out.stderr,
    );
  }
  return out;
}
