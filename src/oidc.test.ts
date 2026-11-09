// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { withOIDCTokenFile } from "./oidc.ts";

for (const fail of [false, true]) {
  test(`OIDC token file is private and cleaned up after ${fail ? "failure" : "success"}`, async () => {
    let directory = "";
    const token = "test-token";
    const connection = withOIDCTokenFile(token, async (tokenFile) => {
      directory = path.dirname(tokenFile);
      assert.equal(fs.readFileSync(tokenFile, "utf8"), token);
      if (process.platform !== "win32") {
        assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
        assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
      }
      assert.ok(!`--id-token=file:${tokenFile}`.includes(token));
      if (fail) throw new Error("connection failed");
      return "connected";
    });
    if (fail) {
      await assert.rejects(connection, /connection failed/);
    } else {
      assert.equal(await connection, "connected");
    }
    assert.equal(fs.existsSync(directory), false);
  });
}

test("concurrent connections use separate token files", async () => {
  const files = new Set<string>();
  await Promise.all(
    ["first", "second"].map((token) =>
      withOIDCTokenFile(token, async (tokenFile) => {
        files.add(tokenFile);
        await Promise.resolve();
        assert.equal(fs.readFileSync(tokenFile, "utf8"), token);
      }),
    ),
  );
  assert.equal(files.size, 2);
  for (const file of files)
    assert.equal(fs.existsSync(path.dirname(file)), false);
});
