// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as core from "@actions/core";
import { isIP } from "net";
import { execCommand, logInfo } from "./logging";
import type { LogMode } from "./logging";

export type tailnetInfo = {
  MagicDNSSuffix: string;
  MagicDNSEnabled: boolean;
};

type savedDNS = {
  service: string;
  servers: string[];
  domains: string[];
};

const stateKey = "macos-dns";
const goFalse = ["0", "f", "F", "false", "FALSE", "False"];

export function acceptsDNS(args: string): boolean {
  let accept = true;
  for (const arg of args.split(" ").filter(Boolean)) {
    const flag = arg.match(/^--?accept-dns(?:=(.*))?$/);
    if (flag) {
      accept = !goFalse.includes(flag[1] ?? "true");
    }
  }
  return accept;
}

async function output(
  cmd: string,
  args: string[],
  logMode: LogMode,
): Promise<string[]> {
  const { stdout } = await execCommand(cmd, args, { logMode, silent: true });
  return stdout.split("\n").map((line) => line.trim());
}

async function defaultService(logMode: LogMode): Promise<string | undefined> {
  const route = await output("route", ["-n", "get", "default"], logMode);
  const device = route
    .map((line) => line.match(/^interface:\s*(\S+)$/)?.[1])
    .find(Boolean);

  const order = await output(
    "networksetup",
    ["-listnetworkserviceorder"],
    logMode,
  );
  for (let i = 0; i < order.length - 1; i++) {
    const name = order[i].match(/^\(\d+\) (.+)$/)?.[1];
    const port = order[i + 1].match(/, Device: (\S*)\)$/)?.[1];
    if (name && device && port === device) {
      return name;
    }
  }
}

async function readDNS(service: string, logMode: LogMode): Promise<savedDNS> {
  const servers = await output(
    "networksetup",
    ["-getdnsservers", service],
    logMode,
  );
  const domains = await output(
    "networksetup",
    ["-getsearchdomains", service],
    logMode,
  );
  return {
    service,
    servers: servers.filter((line) => isIP(line) !== 0),
    domains: domains.filter((line) => line !== "" && !/\s/.test(line)),
  };
}

async function writeDNS(dns: savedDNS, logMode: LogMode): Promise<void> {
  const orEmpty = (values: string[]) => (values.length ? values : ["Empty"]);
  await execCommand(
    "networksetup",
    ["-setdnsservers", dns.service, ...orEmpty(dns.servers)],
    { logMode, label: "set dns servers" },
  );
  await execCommand(
    "networksetup",
    ["-setsearchdomains", dns.service, ...orEmpty(dns.domains)],
    { logMode, label: "set search domains" },
  );
}

export async function configureDNSOnMacOS(
  tailnet: tailnetInfo,
  args: string,
  logMode: LogMode,
): Promise<void> {
  if (!tailnet.MagicDNSEnabled) {
    logInfo(logMode, "MagicDNS is disabled, not configuring DNS");
    return;
  }
  if (!acceptsDNS(args)) {
    logInfo(logMode, "--accept-dns is false, not configuring DNS");
    return;
  }

  let original: savedDNS;
  try {
    const service = await defaultService(logMode);
    if (!service) {
      core.warning(
        "No network service found for the default route, not configuring DNS",
      );
      return;
    }
    original = await readDNS(service, logMode);
  } catch (e) {
    core.warning(`Failed to read DNS settings, not configuring DNS: ${e}`);
    return;
  }

  logInfo(
    logMode,
    `Setting system DNS server on ${original.service} to 100.100.100.100 and searchdomains to ${tailnet.MagicDNSSuffix}`,
  );
  core.saveState(stateKey, JSON.stringify(original));
  try {
    await writeDNS(
      {
        service: original.service,
        servers: ["100.100.100.100"],
        domains: [tailnet.MagicDNSSuffix],
      },
      logMode,
    );
  } catch (e) {
    throw Error(`Failed to configure DNS on macOS: ${e}`);
  }
}

export async function restoreDNSOnMacOS(logMode: LogMode): Promise<void> {
  const saved = core.getState(stateKey);
  if (!saved) {
    return;
  }

  const original: savedDNS = JSON.parse(saved);
  logInfo(logMode, `Restoring DNS settings on ${original.service}`);
  await writeDNS(original, logMode);
}
