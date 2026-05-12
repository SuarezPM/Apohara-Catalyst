import jwt from "@fastify/jwt";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { EventLedger } from "../../../src/core/ledger.js";
import {
	type LLMResponse,
	ProviderRouter,
	type RouterConfig,
} from "../../../src/providers/router.js";

const fastify = Fastify({ logger: true });

declare module "fastify" {
	interface FastifyInstance {
		authenticate: (
			request: FastifyRequest,
			reply: FastifyReply,
		) => Promise<void>;
	}
}

// Setup Event Ledger
const ledger = new EventLedger();

// Register JWT
fastify.register(jwt, {
	secret: "supersecret",
});

// Decorate request with authenticate
fastify.decorate(
	"authenticate",
	async (request: FastifyRequest, reply: FastifyReply) => {
		try {
			await request.jwtVerify();
		} catch (err) {
			reply.send(err);
		}
	},
);

// Health endpoint - returns 200 OK
fastify.get("/health", async (request, reply) => {
	return { status: "ok", timestamp: new Date().toISOString() };
});

// API Users endpoint - returns user list
fastify.get("/api/users", async (request, reply) => {
	return {
		users: [
			{ id: 1, name: "Alice", email: "alice@example.com" },
			{ id: 2, name: "Bob", email: "bob@example.com" },
			{ id: 3, name: "Charlie", email: "charlie@example.com" },
		],
	};
});

// API Items endpoint - returns item list
fastify.get("/api/items", async (request, reply) => {
	return {
		items: [
			{ id: 1, name: "Item One", price: 9.99 },
			{ id: 2, name: "Item Two", price: 19.99 },
			{ id: 3, name: "Item Three", price: 29.99 },
		],
	};
});

// POST /auth/login
fastify.post("/auth/login", async (request, reply) => {
	const { username, password } = request.body as any;

	let response: LLMResponse;

	if (process.env.USE_STUB_PROVIDER === "true") {
		response = {
			content: "1 hour",
			provider: "stub" as any,
			model: "stub-model",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		};
		await ledger.log(
			"provider_selected",
			{ provider: "stub", message: "Using stub provider" },
			"info",
			undefined,
			{ provider: "stub" as any },
		);
	} else {
		const config: RouterConfig = {
			simulateFailure: process.env.SIMULATE_FAILURE === "true",
		};
		const router = new ProviderRouter(config);
		response = await router.completion({
			messages: [
				{
					role: "user",
					content:
						"What is a good expiry time for a JWT token? Answer with a short duration.",
				},
			],
		});
		await ledger.log(
			"provider_selected",
			{
				provider: response.provider,
				message: "Provider returned JWT expiry recommendation",
			},
			"info",
			undefined,
			{ provider: response.provider },
		);
	}

	// sign token
	const token = fastify.jwt.sign({
		username,
		metadata: response.content,
	});

	return { token, provider: response.provider, model: response.model };
});

// GET /api/protected
fastify.get(
	"/api/protected",
	{
		onRequest: [fastify.authenticate],
	},
	async (request, reply) => {
		const user = request.user as any;
		return {
			user: user.username,
			message: "This is a protected resource",
			providerUsed: user.metadata,
		};
	},
);

export const app = fastify;

const start = async () => {
	try {
		await fastify.listen({ port: 3000, host: "0.0.0.0" });
		console.log("Server listening on http://localhost:3000");
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

if (process.env.NODE_ENV !== "test") {
	start();
}
