import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
const scenarioNameSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, {
    message: 'Use lowercase letters, numbers, underscores, or dashes, starting with a letter.',
});
const timeoutMinutesSchema = z.number().int().positive().max(120);
const scenarioBaseSchema = z.object({
    paths: z.array(z.string().min(1)).optional(),
    max_minutes: timeoutMinutesSchema.optional(),
});
const agentScenarioSchema = scenarioBaseSchema.extend({
    driver: z.literal('agent'),
    instructions: z.string().min(1),
});
const commandScenarioSchema = scenarioBaseSchema.extend({
    driver: z.literal('command'),
    command: z.string().min(1),
});
const playwrightScenarioSchema = scenarioBaseSchema.extend({
    driver: z.literal('playwright'),
    command: z.string().min(1),
});
const scenarioSchema = z.discriminatedUnion('driver', [
    agentScenarioSchema,
    commandScenarioSchema,
    playwrightScenarioSchema,
]);
const sanityConfigSchema = z.object({
    sandbox: z.object({
        snapshot: z.string().min(1),
        env: z.record(z.string(), z.string()).optional(),
        secrets: z.array(z.string().min(1)).optional(),
    }),
    setup: z.array(z.string().min(1)).default([]),
    app: z.object({
        start: z.string().min(1),
        port: z.number().int().min(3000).max(9999),
        healthcheck: z.string().min(1).optional(),
    }),
    scenarios: z.record(scenarioNameSchema, scenarioSchema).refine(scenarios => Object.keys(scenarios).length > 0, {
        message: 'Define at least one sanity scenario.',
    }),
    artifacts: z
        .object({
        recording: z.boolean().default(true),
        screenshots: z.boolean().default(true),
        logs: z.boolean().default(true),
    })
        .default({
        recording: true,
        screenshots: true,
        logs: true,
    }),
});
export async function loadSanityConfig(configPath) {
    const absolutePath = path.resolve(configPath);
    const file = await readFile(absolutePath, 'utf8');
    const parsedYaml = YAML.parse(file);
    return sanityConfigSchema.parse(parsedYaml);
}
export function formatConfigError(error) {
    if (error instanceof z.ZodError) {
        return z.prettifyError(error);
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
