import "@fontsource/press-start-2p/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
	throw new Error("#root not found in index.html");
}

createRoot(container).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
