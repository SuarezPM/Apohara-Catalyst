import { render, Text } from "ink";
import React from "react";
import { DashboardApp } from "./components/DashboardApp.tsx";

if (!process.stdin.isTTY) {
	render(
		<Text dimColor>Dashboard requires an interactive terminal (TTY).</Text>,
	);
	process.exit(1);
}

render(<DashboardApp />);
