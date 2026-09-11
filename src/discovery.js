import os from "node:os";
import { Bonjour } from "bonjour-service";

import { loadOrCreateNode, getNodeMetadata } from "./identity.js";

const VERSION = "0.2.0";

const DISCOVERY_PORT = Number(process.env.OPENVARDE_DISCOVERY_PORT || 80);

const CONFIGURED_INTERFACE = process.env.OPENVARDE_INTERFACE || null;

/*
 * Network interface selection
 */

function getIPv4ForInterface(interfaceName) {
  const interfaces = os.networkInterfaces();

  const addresses = interfaces[interfaceName];

  if (!addresses) {
    throw new Error(`Network interface "${interfaceName}" does not exist`);
  }

  const address = addresses.find(
    (entry) => entry.family === "IPv4" && !entry.internal,
  );

  if (!address) {
    throw new Error(
      `Network interface "${interfaceName}" has no usable IPv4 address`,
    );
  }

  return address.address;
}

function autoDetectLanInterface() {
  const interfaces = os.networkInterfaces();

  /*
   * Prefer normal physical interface names first.
   *
   * Raspberry Pi / Debian may typically use:
   *   eth0
   *   end0
   *   wlan0
   *
   * Other Linux systems may use:
   *   enp1s0
   *   eno1
   *   ens18
   */
  const preferredNames = ["eth0", "end0", "wlan0"];

  /*
   * First try exact preferred interface names.
   */
  for (const interfaceName of preferredNames) {
    const addresses = interfaces[interfaceName];

    if (!addresses) {
      continue;
    }

    const address = addresses.find(
      (entry) => entry.family === "IPv4" && !entry.internal,
    );

    if (address) {
      return {
        interfaceName,
        address: address.address,
      };
    }
  }

  /*
   * Then try common Linux physical interface prefixes.
   */
  const preferredPrefixes = ["en", "wl"];

  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (!preferredPrefixes.some((prefix) => interfaceName.startsWith(prefix))) {
      continue;
    }

    if (!addresses) {
      continue;
    }

    const address = addresses.find(
      (entry) => entry.family === "IPv4" && !entry.internal,
    );

    if (address) {
      return {
        interfaceName,
        address: address.address,
      };
    }
  }

  /*
   * Final fallback:
   * find the first non-loopback IPv4 interface,
   * while excluding obvious Docker interfaces.
   */
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (
      interfaceName === "docker0" ||
      interfaceName.startsWith("br-") ||
      interfaceName.startsWith("veth")
    ) {
      continue;
    }

    if (!addresses) {
      continue;
    }

    const address = addresses.find(
      (entry) => entry.family === "IPv4" && !entry.internal,
    );

    if (address) {
      return {
        interfaceName,
        address: address.address,
      };
    }
  }

  throw new Error("Could not automatically determine a LAN interface");
}

function getDiscoveryInterface() {
  if (CONFIGURED_INTERFACE) {
    return {
      interfaceName: CONFIGURED_INTERFACE,
      address: getIPv4ForInterface(CONFIGURED_INTERFACE),
    };
  }

  return autoDetectLanInterface();
}

/*
 * Node identity
 */

const node = loadOrCreateNode();

const metadata = getNodeMetadata(node);

/*
 * Select network interface
 */

const network = getDiscoveryInterface();

console.log(`Discovery interface: ${network.interfaceName}`);

console.log(`Discovery address: ${network.address}`);

/*
 * Bonjour / mDNS / DNS-SD
 */

const bonjour = new Bonjour(
  {
    interface: network.address,
  },
  (error) => {
    console.error("mDNS error:", error);
  },
);

const service = bonjour.publish({
  name: metadata.name,

  type: "openvarde",

  protocol: "tcp",

  host: metadata.hostname,

  port: DISCOVERY_PORT,

  /*
   * OpenVarde does not currently need IPv6 discovery.
   *
   * Explicitly disabling it also prevents unexpected
   * Docker/link-local IPv6 addresses from being published.
   */
  disableIPv6: true,

  txt: {
    version: VERSION,

    node_id: metadata.id,

    short_id: metadata.shortId,

    well_known: "/.well-known/openvarde",
  },
});

service.on("up", () => {
  console.log("OpenVarde discovery published");

  console.log(`Node ID: ${metadata.id}`);

  console.log(`Service: ${metadata.name}._openvarde._tcp.local`);

  console.log(`Hostname: ${metadata.hostname}`);

  console.log(`Target port: ${DISCOVERY_PORT}`);

  console.log(`mDNS interface: ${network.interfaceName} (${network.address})`);
});

service.on("error", (error) => {
  console.error("Failed to publish OpenVarde discovery:", error);
});

/*
 * Graceful shutdown
 */

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`Received ${signal}, stopping discovery...`);

  try {
    service.stop(() => {
      try {
        bonjour.destroy();
      } finally {
        process.exit(0);
      }
    });
  } catch (error) {
    console.error("Failed to stop discovery service:", error);

    try {
      bonjour.destroy();
    } finally {
      process.exit(1);
    }
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("SIGINT", () => shutdown("SIGINT"));
