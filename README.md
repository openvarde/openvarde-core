# openvarde-core

**Core** is mandatory and provides core feature to generate a unique OpenVarde Node-ID. It also publish the ID and state to MQTT if you have chosen to install openvarde-mqtt module.

**OpenVarde** is an open-source, modular platform for building resilient and offline-capable information systems for preparedness and emergency use.

## Features

* Generates Node ID for use by other modules
* Publish Node ID and state to MQTT broker

## Integration

This module integrates with OpenVarde through:

* **MQTT:** opevarde/nodes/ov-[id]
* **HTTP:** http://openvarde-[short-id].local
* **mDNS:** openvarde-[short-id].local
* **Dependencies:** `[no dependencies]`

## Getting started

### Requirements

* Docker
* Docker Compose

### Run

```bash id="ht13no"
git clone https://github.com/openvarde/openvarde-core.git
cd openvarde-core
docker compose up -d
```

View logs:

```bash id="k9md4g"
docker compose logs -f
```

## Configuration

No configuration available.

## Discussion & contributing

OpenVarde is under active development. Testing, bug reports, documentation improvements and code contributions are welcome.

For bugs and concrete development tasks, please use GitHub Issues.

For questions, ideas and general discussion, visit the [OpenVarde thread on Norsk Beredskapsforum](https://norskberedskapsforum.no/topic/1871-prosjekt-openvarde-åpen-og-modulær-beredskaps-pc-for-bruk-med-og-uten-internett/).

## AI disclosure

AI-assisted tools are used in the development of OpenVarde, including code, documentation and technical problem solving. AI-assisted contributions are reviewed and treated as development input, not authoritative output.

## License

See `LICENSE` for licensing information.
