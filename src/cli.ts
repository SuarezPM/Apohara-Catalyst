#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { authCommand } from "./commands/auth.js";
import { autoCommand } from "./commands/auto.js";
import { configCommand } from "./commands/config.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { replayCommand } from "./commands/replay.js";
import { stateCommand } from "./commands/state.js";
import { statsCommand } from "./commands/stats.js";
import { uninstallCommand } from "./commands/uninstall.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
	readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program.name("apohara").description("Apohara CLI").version(packageJson.version);

program.addCommand(configCommand);
program.addCommand(authCommand);
program.addCommand(autoCommand);
program.addCommand(dashboardCommand);
program.addCommand(replayCommand);
program.addCommand(stateCommand);
program.addCommand(statsCommand);
program.addCommand(uninstallCommand);

program.parse(process.argv);
