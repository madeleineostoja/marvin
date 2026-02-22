import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";

export const ModelsSchema = z.object({
  orchestrator: z.string().default("opus"),
  builder: z.string().default("sonnet"),
  reviewer: z.string().default("opus"),
});

export type ModelsConfig = z.infer<typeof ModelsSchema>;

export const MarvinConfigSchema = z.object({
  harness: z.enum(["claude", "opencode"]).default("claude"),
  plan: z.string().optional(),
  maxIterations: z.number().default(50),
  preflight: z.string().nullable().optional(),
  models: ModelsSchema.default({ orchestrator: "opus", builder: "sonnet", reviewer: "opus" }),
  sandbox: z.object({
    enabled: z.boolean().default(true),
    domains: z.array(z.string()).default([]),
  }).default({ enabled: true, domains: [] }),
});

export type MarvinConfig = z.infer<typeof MarvinConfigSchema>;

type CliOverrides = {
  harness?: string;
  plan?: string;
  maxIterations?: number;
};

export async function loadConfig(
  configPath: string,
  cliOverrides: CliOverrides,
): Promise<MarvinConfig> {
  let fileData: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf-8");
    fileData = JSON.parse(raw) as Record<string, unknown>;
  }

  const merged = { ...fileData, ...cliOverrides };

  return MarvinConfigSchema.parse(merged);
}
