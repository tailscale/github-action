// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Keep the token out of command arguments, including when runner debug logging
// is enabled. The file remains available across retries and is removed on exit.
export async function withOIDCTokenFile<T>(
  token: string,
  connect: (tokenFile: string) => Promise<T>,
): Promise<T> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tailscale-oidc-"));
  try {
    fs.chmodSync(directory, 0o700);
    const tokenFile = path.join(directory, "token");
    fs.writeFileSync(tokenFile, token, { mode: 0o600, flag: "wx" });
    return await connect(tokenFile);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
