export type ToolMetadata = {
  output?: string;
  exitCode?: number;
  truncated?: boolean;
  error?: string;
};

export type StreamEvent =
  | { type: "text"; text: string; timestamp: number }
  | { type: "tool"; tool: string; status: string; input?: Record<string, unknown>; metadata?: ToolMetadata; timestamp: number };

export type InvocationHandle = {
  pid: number | undefined;
  events: AsyncIterable<StreamEvent>;
  result: Promise<{ exitCode: number | null }>;
};

export type HarnessConfig = {
  workspaceRoot: string;
  planFile: string;
  models: {
    orchestrator: string;
    builder: string;
    reviewer: string;
  };
  sandbox: {
    enabled: boolean;
    domains: string[];
  };
};

export type Harness = {
  name: string;
  invoke(config: HarnessConfig, iteration: number, signal: AbortSignal): InvocationHandle;
};
