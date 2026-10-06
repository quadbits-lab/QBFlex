/**
 * Workflow canvas adapted from the approvals-ui registry
 * (https://approvals-ui.vercel.app/, registry:workflow-canvas) for QB Flex
 * schema topology: automatic layout via react-flow-auto-layout, aligned step
 * edges, and theme-variable styling. Consumers pass generic React Flow
 * nodes/edges — domain nodes (e.g. database tables) render themselves.
 */
import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type EdgeProps,
  EdgeText,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { AlignedStepEdge, useAutoLayout, withAlignedElbows } from 'react-flow-auto-layout/react';
import { cn } from '../lib/utils';

function LabeledAlignedStepEdge(props: EdgeProps) {
  return (
    <>
      <AlignedStepEdge {...props} />
      {props.label && (
        <EdgeText
          x={(props.sourceX + props.targetX) / 2}
          y={(props.sourceY + props.targetY) / 2}
          label={props.label}
          labelStyle={props.labelStyle}
          labelBgStyle={props.labelBgStyle}
          labelShowBg
        />
      )}
    </>
  );
}
const EDGE_TYPES = { alignedStep: LabeledAlignedStepEdge } satisfies EdgeTypes;

export type CanvasColorMode = 'dark' | 'light';
export type WorkflowCanvasProps = {
  nodes: Node[];
  edges: Edge[];
  className?: string;
  /** React Flow color mode; defaults to following the app's .light toggle. */
  colorMode?: CanvasColorMode;
  nodeTypes?: NodeTypes;
  vertical?: boolean;
  nodeSep?: number;
  rankSep?: number;
  selectedId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  focus?: { nodeId: string } | null;
  showMiniMap?: boolean;
  children?: React.ReactNode;
};

const CanvasInner = ({
  nodes: sourceNodes,
  edges: sourceEdges,
  nodeTypes,
  vertical = true,
  nodeSep,
  rankSep,
  selectedId,
  onSelectNode,
  focus,
  showMiniMap = false,
  colorMode = 'dark',
  children,
}: WorkflowCanvasProps) => {
  const reactFlow = useReactFlow();
  const nodes = useMemo(
    () => sourceNodes.map((node) => ({ ...node, selected: selectedId === node.id })),
    [sourceNodes, selectedId],
  );
  const layout = useAutoLayout({
    nodes,
    edges: withAlignedElbows(sourceEdges),
    vertical,
    nodeSep,
    rankSep,
  });
  const structureKey = useMemo(
    () =>
      `${vertical}:${sourceNodes.map((n) => n.id).join(',')}|${sourceEdges
        .map((e) => e.id)
        .join(',')}`,
    [sourceNodes, sourceEdges, vertical],
  );
  useEffect(() => {
    const frame = setTimeout(() => {
      void reactFlow.fitView({
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300,
        padding: 0.15,
        maxZoom: 1,
      });
    }, 180);
    return () => clearTimeout(frame);
  }, [structureKey, reactFlow]);
  useEffect(() => {
    if (!focus) return;
    const node = reactFlow.getNode(focus.nodeId);
    if (!node) return;
    void reactFlow.fitView({
      nodes: [node],
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400,
      padding: 0.4,
      maxZoom: 1.1,
    });
  }, [focus, reactFlow]);
  return (
    <ReactFlow
      colorMode={colorMode}
      nodes={layout.nodes}
      edges={layout.edges.map((edge: Edge) => ({ ...edge, type: 'alignedStep' }))}
      onNodesChange={layout.onNodesChange}
      onEdgesChange={layout.onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.25}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable
      onNodeClick={(_, node) => onSelectNode?.(node.id)}
      onPaneClick={() => onSelectNode?.(null)}
      className="bg-background"
    >
      <Background gap={18} />
      <Controls showInteractive={false} />
      {showMiniMap && <MiniMap pannable zoomable />}
      {children}
    </ReactFlow>
  );
};

const FLOW_THEME: React.CSSProperties & Record<`--${string}`, string> = {
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-background-color-hover': 'var(--muted)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-controls-button-color-hover': 'var(--foreground)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-attribution-background-color': 'transparent',
  '--xy-minimap-background-color': 'var(--muted)',
  '--xy-minimap-mask-background-color': 'color-mix(in oklab, var(--background) 60%, transparent)',
};

function documentColorMode(): CanvasColorMode {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
}

export function WorkflowCanvas({ className, colorMode, ...props }: WorkflowCanvasProps) {
  // React Flow injects a color-mode class that switches design tokens inside the
  // canvas subtree; tie it to the app theme instead of the system preference.
  const initial = colorMode ?? documentColorMode();
  const [mode, setMode] = useState<CanvasColorMode>(initial);
  useEffect(() => {
    if (colorMode) {
      setMode(colorMode);
      return;
    }
    setMode(documentColorMode());
    const observer = new MutationObserver(() => setMode(documentColorMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [colorMode, initial]);
  return (
    <div className={cn('h-full w-full bg-background', className)} style={FLOW_THEME}>
      <ReactFlowProvider>
        <CanvasInner colorMode={mode} {...props} />
      </ReactFlowProvider>
    </div>
  );
}
