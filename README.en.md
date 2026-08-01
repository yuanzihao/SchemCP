# SchemCP

> Local-first schematic context for AI coding agents.

[简体中文](README.md)

SchemCP is a local-first, read-only, deterministic, and auditable Model Context Protocol server for JLCEDA Pro schematic projects. It parses user-provided `.epro2` archives directly and does not require a browser, EasyEDA Bridge, a JLCEDA plugin API, or a PCB editor.

> **Format scope**: SchemCP currently maintains parsing only for JLCEDA Pro `.epro2` schematic projects. Support for schematic formats from other EDA applications is not planned. For Altium Designer, KiCad, OrCAD, or similar projects, import the design into JLCEDA Pro, manually verify hierarchy, components, pins, and nets, then export an `.epro2` file for SchemCP. SchemCP neither reads the original third-party format nor verifies conversion completeness.

## Name

**SchemCP = Schematic + MCP**

SchemCP is a schematic context service for MCP clients. The name can be read as `Sche[m] + MCP → SchemCP`, with the letter `M` shared by both words.

Current version: `0.1.0`

MCP Registry name: `io.github.yuanzihao/schemcp`

npm package: `@yuanzihao/schemcp`

License: Apache-2.0

> `@yuanzihao/schemcp@0.1.0` is published on npm and can be started directly with the `npx` command below. Treat the [official npm page](https://www.npmjs.com/package/@yuanzihao/schemcp) as the source of truth for versions and integrity metadata.

## Why SchemCP

- **Offline schematic parsing**: normal queries operate on local `.epro2` files without an online service.
- **Stable intermediate representation**: the public EDA-IR is identified as `schemcp.eda-ir` 1.1.0 and hashes deterministic content.
- **Attachment-first startup**: the MCP server starts without a project and opens a file only after the user explicitly supplies it.
- **Multi-project workspace**: one session can hold up to four projects and user-declared assemblies.
- **Component context**: resolve both supported INSTANCE path encodings and query base components or effective designators, attributes, pin overrides, and network evidence in one hierarchy occurrence.
- **Optional `.enet` evidence**: bind a netlist to one project when exact pin-to-net endpoint comparison is needed.
- **Explicit truth boundaries**: project facts, part facts, and engineering inferences remain distinguishable.
- **Read-only and bounded**: tools use pagination, stable error codes, and input limits; SchemCP does not edit schematics or generate firmware.

The current product scope is limited to JLCEDA Pro schematics. The public MCP contract exposes no PCB tools and has no Chrome, Bridge, or online API dependency.

SchemCP is an independent community project and is not affiliated with, authorized by, or endorsed by JLC, LCSC, JLCEDA, or EasyEDA. All related trademarks belong to their respective owners.

## Support matrix

### Operating systems

| Platform | 0.1.0 status | Release gate |
| --- | --- | --- |
| Linux x64 | Supported | Full tests, coverage, two deterministic packs, offline install, and MCP protocol acceptance |
| macOS arm64/x64 | Supported | Full tests, two deterministic packs, offline install, and MCP protocol acceptance |
| Windows x64 | Compatibility implemented; real-host acceptance pending | Full tests, two deterministic packs, offline installation, and synthetic project/netlist/assembly acceptance pass; real Windows private-project acceptance is not yet claimed |

Linux and macOS enforce private `0700/0600` directory and file modes. Windows does not present `chmod` as a POSIX permission guarantee: SchemCP still enforces absolute canonical paths, exclusive creation, regular files, and symbolic-link/link-type reparse-point rejection, while every MCP result reports `WINDOWS_ACL_NOT_VERIFIED` under `platformSecurity`. Organizations requiring managed ACLs should configure Windows directory ACLs at deployment time.

### Input formats and capabilities

| Capability | 0.1.0 status |
| --- | --- |
| Offline JLCEDA Pro `.epro2` schematic parsing | Supported |
| Project-scoped user-provided `.enet` binding | Supported; authenticity and project binding remain unverified |
| Component, pin, explicit net-label, and geometric-candidate queries | Supported |
| User-confirmed multi-project connector mappings | Supported |
| Altium, KiCad, OrCAD, and other EDA schematic formats | Not supported and not planned; import into JLCEDA Pro, verify the conversion, and export `.epro2` first |
| PCB, online Bridge, plugin APIs, project mutation, and code generation | Not supported |

## Run with one command

Node.js 22 or newer is required.

Any local stdio MCP client can run the published version directly:

```bash
npx -y @yuanzihao/schemcp
```

With no arguments, this command starts the MCP stdio server. stdout is reserved for protocol messages and diagnostics are written to stderr.

Show the companion CLI:

```bash
npx -y @yuanzihao/schemcp --help
```

The explicit MCP form is also supported:

```bash
npx -y @yuanzihao/schemcp mcp
```

## Client setup

### Codex

```bash
codex mcp add schemcp -- npx -y @yuanzihao/schemcp
codex mcp list
```

Equivalent project-level `.codex/config.toml`:

```toml
[mcp_servers.schemcp]
command = "npx"
args = ["-y", "@yuanzihao/schemcp"]
required = true
startup_timeout_sec = 30
tool_timeout_sec = 30

[mcp_servers.schemcp.env]
NODE_OPTIONS = "--max-old-space-size=512"
```

### Claude Code

```bash
claude mcp add --transport stdio schemcp -- npx -y @yuanzihao/schemcp
claude mcp list
```

Equivalent shared `.mcp.json`:

```json
{
  "mcpServers": {
    "schemcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yuanzihao/schemcp"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=512"
      }
    }
  }
}
```

### Pi

Pi core currently does not include MCP. SchemCP remains a standard stdio server and does not add a Pi-specific protocol; install and review a third-party MCP extension first. The `0.1.0` release acceptance uses Pi `0.83.0` with [`pi-mcp-adapter`](https://pi.dev/packages/pi-mcp-adapter) `2.16.0`:

```bash
pi install npm:pi-mcp-adapter@2.16.0
```

Then create a standard `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "schemcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yuanzihao/schemcp"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=512"
      }
    }
  }
}
```

Pi extensions execute with the current user's privileges, so review the source and version before installation. The adapter is not a SchemCP runtime dependency or part of its core protocol. If Pi gains native stdio MCP support, remove the adapter layer and keep the same server descriptor.

### Cursor, Cline, and other clients

SchemCP does not create a protocol branch for every client. Map this standard stdio descriptor into the client's MCP configuration:

```json
{
  "id": "schemcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@yuanzihao/schemcp"],
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=512"
  }
}
```

An installed package can also generate client-specific wrappers around one canonical descriptor:

```bash
schemcp mcp-config --client generic
schemcp mcp-config --client codex
schemcp mcp-config --client claude-code
```

## First session

1. Prepare a JLCEDA Pro `.epro2` schematic project. Import projects from other EDA applications into JLCEDA Pro and manually verify the conversion first.
2. Attach or select the `.epro2` file in the MCP client.
3. Pass the exact absolute path supplied by the client to `open_schematic_project`.
4. Call `list_schematic_projects` and retain the returned `projectHandle`.
5. Call `list_design_hierarchy` and `list_instance_contexts` first. Pass the returned `instanceContextId` to `list_components`, `get_component`, or `get_component_pins` when effective hierarchy-occurrence properties are required.
6. Only when exact pin-to-net verification is required, call `attach_schematic_netlist` for that project.

Suggested first prompt:

```text
Use schemcp to open the .epro2 attachment I provided. Call
list_schematic_projects and list_design_hierarchy first, then query components
and pins page by page. If no .enet is attached, clearly separate exact project
facts from geometric network candidates.
```

An `.enet` file is optional for ordinary offline analysis. Without one, component, symbol, pin, wire, and explicit net-label queries remain available, while strict connectivity conclusions retain `electricalTruth=NOT_VERIFIED`.

## Multi-project assemblies

SchemCP supports user-declared assemblies of two to four projects:

1. Open each project with `open_schematic_project`.
2. Optionally bind one `.enet` per `projectHandle`.
3. Call `create_schematic_assembly`.
4. Inspect deterministic evidence with `list_interconnect_candidates`.
5. Confirm an explicit pin mapping with `confirm_schematic_interconnect`.
6. Query paths made of in-project networks and confirmed cross-project mappings with `list_assembly_connections`.

Candidates never become connections automatically. SchemCP does not guess mirroring, reversal, or connector orientation, and it does not propagate through resistors, ferrites, zero-ohm links, level shifters, transceivers, Short symbols, or Net Ties.

## Companion CLI

```bash
# Inspect a project without printing private design content
schemcp inspect board.epro2

# Write full EDA-IR explicitly; existing files are not overwritten by default
schemcp compile board.epro2 --output board.eda-ir.json

# Verify a persisted assembly manifest independently
schemcp verify-assembly-manifest assembly.schemcp-assembly.json

# Generate a client-neutral launch descriptor
schemcp mcp-config --client generic
```

Run `schemcp --help` for the complete command reference.

## Local development

```bash
git clone https://github.com/yuanzihao/SchemCP.git
cd SchemCP
npm ci
npm run check
npm test
npm run verify:public-release
```

Run from source:

```bash
npm run build
node dist/src/bin/schemcp.js
```

Build and install a local tarball:

```bash
npm pack
npm install --global ./yuanzihao-schemcp-0.1.0.tgz
schemcp
```

## Documentation and security

- [MCP service reference](docs/MCP_SERVICE.md)
- [48 MCP tools and JSON Schemas](docs/MCP_TOOLS.md)
- [User guide](docs/USER_GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

Do not post real `.epro2` or `.enet` files, datasheets, net-name inventories, absolute local paths, or private assembly manifests in issues, logs, or fixtures. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Copyright 2026 yuanzihao

Licensed under the [Apache License 2.0](LICENSE).
