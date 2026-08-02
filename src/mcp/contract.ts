export const MCP_SERVER_NAME = "schemcp";
export const MCP_SERVER_VERSION = "0.1.0";

export const MCP_TOOL_NAMES = [
  "open_schematic_project",
  "attach_schematic_netlist",
  "detach_schematic_netlist",
  "create_schematic_assembly",
  "list_schematic_assemblies",
  "close_schematic_assembly",
  "list_interconnect_candidates",
  "confirm_schematic_interconnect",
  "list_assembly_connections",
  "get_schematic_assembly_manifest",
  "open_schematic_assembly_manifest",
  "list_schematic_projects",
  "select_schematic_project",
  "get_active_schematic_project",
  "close_schematic_project",
  "get_project_summary",
  "get_netlist_comparison_summary",
  "list_netlist_comparison_tuples",
  "list_bound_electrical_nets",
  "get_net",
  "list_design_hierarchy",
  "list_instance_contexts",
  "get_instance_context",
  "list_components",
  "list_schematic_annotations",
  "list_schematic_graphic_primitives",
  "list_schematic_tables",
  "get_schematic_table",
  "list_symbol_texts",
  "list_unresolved_components",
  "list_part_masters",
  "get_part_master",
  "list_datasheet_references",
  "get_datasheet_section",
  "get_component",
  "get_component_pins",
  "get_component_pin_connectivity",
  "list_direct_component_connections",
  "get_variant",
  "list_variant_overrides",
  "list_explicit_nets",
  "list_buses",
  "list_interfaces",
  "list_candidate_netlist_tuples",
  "list_candidate_netlist_exclusions",
  "list_network_endpoint_candidates",
  "list_short_relation_candidates",
  "diff_project_versions",
  "get_diagnostics",
  "get_evidence"
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_PROCESS_ENV = {
  nodeOptions: "--max-old-space-size=512"
} as const;
