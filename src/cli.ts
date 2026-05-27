#!/usr/bin/env node

import { Command } from 'commander'
import { formatConfigError, loadSanityConfig } from './config.js'
import { createSanityPlan, formatDryRunPlan } from './plan.js'

const program = new Command()

program
  .name('sanity')
  .description('Run trusted verification scenarios against candidate code.')
  .version('0.0.0')

program
  .command('run')
  .description('Build a sanity run plan from a config file.')
  .requiredOption('--config <path>', 'Path to .sanity/sanity.yml')
  .option('--scenario <name>', 'Scenario to run', 'pr')
  .option('--dry-run', 'Print the sanity plan without creating a sandbox', false)
  .action(async options => {
    try {
      const config = await loadSanityConfig(options.config)
      const plan = createSanityPlan(config, options.scenario)

      if (!options.dryRun) {
        throw new Error('Only --dry-run is implemented in this first slice.')
      }

      console.log(formatDryRunPlan(plan))
    } catch (error) {
      console.error(formatConfigError(error))
      process.exitCode = 1
    }
  })

program.parseAsync(process.argv)
