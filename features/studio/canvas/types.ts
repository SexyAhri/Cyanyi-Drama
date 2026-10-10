export type ViewportTransform = { x: number; y: number; k: number };
export type CanvasCard = {
  id: string;
  kind: "text" | "panel" | "image" | "video";
  title: string;
  text: string;
  videoText?: string;
  x: number;
  y: number;
  panelId?: string;
  assetId?: string;
};
export type CanvasDocument = {
  nodes: CanvasCard[];
  edges: Array<{ id: string; from: string; to: string }>;
  viewport: ViewportTransform;
};
