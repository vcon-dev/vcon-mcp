/**
 * OSS vCon "shape graph": corpus-level view of analysis types, attachment purposes,
 * legacy attachment types (no purpose), and tag keys. No business ontology.
 *
 * JSON payload uses explicit kinds so clients can evolve without breaking ids.
 */

export const VCON_SHAPE_GRAPH_SCHEMA_VERSION = '1.0.0' as const;

/** Node kinds emitted by the default shape graph builder */
export type VconShapeGraphNodeKind =
  | 'analysis_type'
  | 'attachment_purpose'
  | 'attachment_type_legacy'
  | 'tag_key';

export interface VconShapeGraphNode {
  /** Stable id within this graph, e.g. "analysis_type:summary" */
  id: string;
  kind: VconShapeGraphNodeKind;
  /** Human-readable label (same as value for type/purpose/key) */
  label: string;
  /** Distinct vCons that reference this node (when available) */
  vcon_count?: number;
}

export type VconShapeGraphEdgeKind = 'analysis_type_with_attachment_purpose';

export interface VconShapeGraphEdge {
  id: string;
  kind: VconShapeGraphEdgeKind;
  source: string;
  target: string;
  /** Distinct vCons where both endpoints co-occur */
  joint_vcon_count: number;
}

export interface VconShapeGraphPayload {
  schema_version: typeof VCON_SHAPE_GRAPH_SCHEMA_VERSION;
  generated_at: string;
  corpus: {
    /** vCons counted in tag-key path (distinct vcon_id in vcon_tags_mv when available) */
    vcons_with_tags_mv?: number;
    notes: string[];
  };
  nodes: VconShapeGraphNode[];
  edges: VconShapeGraphEdge[];
}

/** JSON Schema subset for LLM-facing documentation (not exhaustive of all JSON Schema keywords). */
export const VCON_SHAPE_GRAPH_JSON_SCHEMA = {
  $id: 'https://vcon.dev/mcp/shape-graph/1-0-0',
  title: 'vConShapeGraphPayload',
  type: 'object',
  required: ['schema_version', 'generated_at', 'corpus', 'nodes', 'edges'],
  properties: {
    schema_version: { type: 'string', const: VCON_SHAPE_GRAPH_SCHEMA_VERSION },
    generated_at: { type: 'string', format: 'date-time' },
    corpus: {
      type: 'object',
      required: ['notes'],
      properties: {
        vcons_with_tags_mv: { type: 'integer', minimum: 0 },
        notes: { type: 'array', items: { type: 'string' } },
      },
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'label'],
        properties: {
          id: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['analysis_type', 'attachment_purpose', 'attachment_type_legacy', 'tag_key'],
          },
          label: { type: 'string' },
          vcon_count: { type: 'integer', minimum: 0 },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'source', 'target', 'joint_vcon_count'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', const: 'analysis_type_with_attachment_purpose' },
          source: { type: 'string' },
          target: { type: 'string' },
          joint_vcon_count: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;
