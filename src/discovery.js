import { Bonjour } from "bonjour-service";

import { loadOrCreateNode, getNodeMetadata } from "./identity.js";

const VERSION = "0.2.0";

const DISCOVERY_PORT = Number(process.env.OPENVARDE_DISCOVERY_PORT || 80);

/*
 * Node identity
 */

const node = loadOrCreateNode();

const metadata = getNodeMetadata(node);

/*
 * Bonjour / mDNS / DNS-SD
 */

const bonjour = new Bonjour({}, (error) => {
  console.error("mDNS error:", error);
});

const service = bonjour.publish({
  name: metadata.name,

  type: "openvarde",

  protocol: "tcp",

  host: metadata.hostname,

  port: DISCOVERY_PORT,

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

  console.log(`Target: ${metadata.hostname}:${DISCOVERY_PORT}`);
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
      bonjour.destroy();

      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to stop discovery:", error);

    try {
      bonjour.destroy();
    } finally {
      process.exit(1);
    }
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("SIGINT", () => shutdown("SIGINT"));
