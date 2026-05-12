/**
 * Interactive configuration wizard using Ink TUI.
 * Prompts for API keys and persists to credentials.json.
 */

import * as fs from "node:fs/promises";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import {
	ensureDir,
	getConfigDir,
	getCredentialsPath,
} from "../../src/lib/paths.js";

interface Credentials {
	OPENCODE_API_KEY?: string;
	DEEPSEEK_API_KEY?: string;
	ANTHROPIC_API_KEY?: string;
	OPENAI_API_KEY?: string;
	[key: string]: string | undefined;
}

/**
 * Sanitizes API key values for safe display (showing only last 4 chars).
 */
function sanitizeKey(key: string): string {
	if (!key || key.length < 4) return "****";
	return `****${key.slice(-4)}`;
}

/**
 * Prompts the user for a value, with optional default.
 */
function PromptInput({
	label,
	defaultValue,
	onSubmit,
}: {
	label: string;
	defaultValue?: string;
	onSubmit: (value: string) => void;
}): React.ReactElement {
	const [value, setValue] = useState(defaultValue ?? "");

	useInput((input) => {
		if (input === "\r") {
			// Enter pressed - submit
			onSubmit(value);
		} else if (input === "\u0003") {
			// Ctrl+C
			process.exit(0);
		} else if (input === "\u007f") {
			// Backspace
			setValue((prev) => prev.slice(0, -1));
		} else {
			setValue((prev) => prev + input);
		}
	});

	return (
		<Box flexDirection="column">
			<Text>
				{label}
				{defaultValue && ` (default: ${sanitizeKey(defaultValue)})`}:
			</Text>
			<Text bold> {value}_</Text>
		</Box>
	);
}

/**
 * Renders a confirm prompt.
 */
function ConfirmPrompt({
	label,
	onConfirm,
}: {
	label: string;
	onConfirm: (confirmed: boolean) => void;
}): React.ReactElement {
	const [selected, setSelected] = useState<"yes" | "no">("yes");

	useInput((input) => {
		if (input === "\r") {
			onConfirm(selected === "yes");
		} else if (input === "\x1b\x5b\x41" || input === "\x1b\x5b\x44") {
			// Up or Left
			setSelected("yes");
		} else if (input === "\x1b\x5b\x42" || input === "\x1b\x5b\x43") {
			// Down or Right
			setSelected("no");
		} else if (input === "\u0003") {
			process.exit(0);
		}
	});

	return (
		<Box flexDirection="column">
			<Text>{label}</Text>
			<Box>
				<Text color={selected === "yes" ? "green" : "dim"}>
					[{selected === "yes" ? "✓" : " "}] Yes
				</Text>
				<Text> </Text>
				<Text color={selected === "no" ? "red" : "dim"}>
					[{selected === "no" ? "✓" : " "}] No
				</Text>
			</Box>
		</Box>
	);
}

/**
 * Main Config Wizard component.
 */
export function ConfigWizard({
	existingCredentials,
	onComplete,
}: {
	existingCredentials?: Credentials;
	onComplete: (credentials: Credentials) => void;
}): React.ReactElement {
	const [step, setStep] = useState(0);
	const [credentials, setCredentials] = useState<Credentials>(
		existingCredentials ?? {},
	);

	const fields = [
		{ key: "OPENCODE_API_KEY", label: "OpenCode API Key", required: false },
		{ key: "DEEPSEEK_API_KEY", label: "DeepSeek API Key", required: false },
		{ key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", required: false },
		{ key: "OPENAI_API_KEY", label: "OpenAI API Key", required: false },
	];

	const handleSubmit = (key: string, value: string) => {
		setCredentials((prev) => ({ ...prev, [key]: value }));
		setStep((prev) => prev + 1);
	};

	// Render header
	const renderHeader = () => (
		<Box flexDirection="column" marginBottom={1}>
			<Text bold color="cyan">
				🔧 Clarity Configuration Wizard
			</Text>
			<Text dimColor>Press Ctrl+C to cancel</Text>
		</Box>
	);

	// Show summary and confirm
	if (step === fields.length) {
		const hasKeys = Object.values(credentials).some((v) => v && v.length > 0);
		return (
			<Box flexDirection="column" padding={1}>
				{renderHeader()}
				<Text bold>Summary:</Text>
				{fields.map((field) => {
					const value = credentials[field.key];
					return (
						<Box key={field.key}>
							<Text>{field.label}: </Text>
							<Text color="green">
								{value ? sanitizeKey(value) : "(not set)"}
							</Text>
						</Box>
					);
				})}
				<Box marginTop={1}>
					{hasKeys ? (
						<Text>Press Enter to save, or Esc to go back</Text>
					) : (
						<Text>No API keys set. Press Enter to skip, or Esc to go back</Text>
					)}
				</Box>
				<ConfirmPrompt
					label="Save credentials?"
					onConfirm={(confirmed) => {
						if (confirmed) {
							onComplete(credentials);
						} else {
							setStep(fields.length - 1);
						}
					}}
				/>
			</Box>
		);
	}

	const currentField = fields[step];

	return (
		<Box flexDirection="column" padding={1}>
			{renderHeader()}
			<Text>
				Step {step + 1} of {fields.length}
			</Text>
			<Box marginTop={1}>
				<PromptInput
					label={currentField.label}
					defaultValue={credentials[currentField.key]}
					onSubmit={(value) => handleSubmit(currentField.key, value)}
				/>
			</Box>
		</Box>
	);
}

/**
 * Loads existing credentials from the config directory.
 */
export async function loadCredentials(): Promise<Credentials | null> {
	try {
		const credPath = getCredentialsPath();
		await fs.access(credPath);
		const content = await fs.readFile(credPath, "utf-8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

/**
 * Saves credentials to the config directory with secure permissions (600).
 */
export async function saveCredentials(
	credentials: Credentials,
): Promise<boolean> {
	try {
		const configDir = getConfigDir();
		if (!ensureDir(configDir)) {
			console.error("[config] Failed to create config directory");
			return false;
		}

		const credPath = getCredentialsPath();
		await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), "utf-8");

		// Set file permissions to 600 (owner read/write only)
		await fs.chmod(credPath, 0o600);
		console.log(`[config] Saved credentials to ${credPath}`);
		return true;
	} catch (err) {
		console.error("[config] Failed to save credentials:", err);
		return false;
	}
}

/**
 * Run the interactive config wizard (used by CLI).
 */
export async function runConfigWizard(): Promise<void> {
	const _existing = await loadCredentials();
	console.log("Starting config wizard...");
	// Note: Full interactive mode would require running through Ink's render
	// For now, we provide a simpler CLI-based approach in the command handler
}
