export type ToolMetadata = {
  output?: string;
  exitCode?: number;
  truncated?: boolean;
  error?: string;
};

export type AgentInfo = {
  agent: string;
  model: string;
};

export type ModelUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type StreamEvent =
  | { type: "text"; text: string; timestamp: number; agentInfo?: AgentInfo }
  | {
      type: "tool";
      tool: string;
      status: string;
      input?: Record<string, unknown>;
      metadata?: ToolMetadata;
      timestamp: number;
      agentInfo?: AgentInfo;
    }
  | {
      type: "summary";
      modelUsage: Record<string, ModelUsageEntry>;
      timestamp: number;
    }
  | { type: "stderr"; text: string; timestamp: number };

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
    build: string;
    review: string;
  };
  sandbox: {
    enabled: boolean;
    domains: string[];
  };
};

export type Harness = {
  name: string;
  invoke(
    config: HarnessConfig,
    iteration: number,
    signal: AbortSignal,
  ): InvocationHandle;
};
