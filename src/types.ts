export type CanvasContextKind = "2d" | "webgl" | "webgl2" | "webgpu" | "bitmaprenderer" | "unknown";

export type DrawCallCategory =
  | "fill"
  | "stroke"
  | "path"
  | "image"
  | "transform"
  | "state"
  | "clear"
  | "other";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasMetadata {
  id: string;
  index: number;
  canvas: HTMLCanvasElement;
  contextType: CanvasContextKind;
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  visible: boolean;
}

export interface CanvasState {
  [property: string]: unknown;
  transform: number[];
  lineDash: number[];
}

export interface DrawCall {
  id: string;
  index: number;
  frame: number;
  name: string;
  category: DrawCallCategory;
  args: unknown[];
  rawArgs: unknown[];
  state: CanvasState;
  bounds: Bounds | null;
  duration: number;
  timestamp: number;
  stack: string[];
  signature: string | null;
  repeated: number;
}

export interface FrameProfile {
  index: number;
  label: string | null;
  startEvent: number;
  endEvent: number;
  duration: number;
  fps: number;
  callCount: number;
  pixelCalls: number;
  slow: boolean;
  methodCounts: Record<string, number>;
  timestamp: number;
  snapshot: string | null;
}

export interface CanvasInteraction {
  type: string;
  frame: number;
  x: number;
  y: number;
  buttons: number;
  deltaY: number;
  timestamp: number;
}

export interface Hotspot {
  name: string;
  calls: number;
  total: number;
  average: number;
  max: number;
}

export interface RepeatedDraw {
  signature: string;
  count: number;
}

export interface InspectorOptions {
  maxEvents?: number;
  maxFrames?: number;
  captureFrameSnapshots?: boolean;
  snapshotInterval?: number;
  captureStack?: boolean;
  slowFrameThreshold?: number;
  contextAttributes?: CanvasRenderingContext2DSettings;
  context?: CanvasRenderingContext2D;
  patchCanvas?: boolean;
}

export interface CanvasInspectorEvents {
  record: DrawCall;
  frame: FrameProfile;
  interaction: CanvasInteraction;
  statechange: { enabled?: boolean; paused?: boolean };
  clear: undefined;
}

export interface InstallOptions extends InspectorOptions {
  autoFrame?: boolean;
  observe?: boolean;
}

export interface PanelOptions {
  target?: HTMLElement;
  position?: "bottom" | "right";
  height?: number;
  startOpen?: boolean;
}
