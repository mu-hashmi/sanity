export function createSanityPlan(config, scenarioName) {
    const scenario = config.scenarios[scenarioName];
    if (!scenario) {
        const available = Object.keys(config.scenarios).sort().join(', ');
        throw new Error(`Unknown scenario "${scenarioName}". Available scenarios: ${available}`);
    }
    return {
        scenarioName,
        config,
        scenario,
    };
}
export function formatDryRunPlan(plan) {
    const { config, scenario, scenarioName } = plan;
    const lines = [
        'Sanity plan:',
        `- sandbox: ${config.sandbox.snapshot}`,
        `- setup: ${config.setup.length > 0 ? config.setup.join(' && ') : '(none)'}`,
        `- app: ${config.app.start}`,
        `- port: ${config.app.port}`,
        `- healthcheck: ${config.app.healthcheck ?? '(none)'}`,
        `- scenario: ${scenarioName}`,
        `- driver: ${scenario.driver}`,
        `- paths: ${scenario.paths?.join(', ') ?? '(not path-scoped)'}`,
    ];
    if (scenario.driver === 'agent') {
        lines.push(`- instructions: ${scenario.instructions}`);
    }
    else {
        lines.push(`- command: ${scenario.command}`);
    }
    lines.push(`- max minutes: ${scenario.max_minutes ?? '(default)'}`);
    lines.push(`- artifacts: recording=${config.artifacts.recording}, screenshots=${config.artifacts.screenshots}, logs=${config.artifacts.logs}`);
    return lines.join('\n');
}
