import { expect, test } from "bun:test";
import { TaggedEventBus } from "../../src/core/tagged-bus";

test("publish with tags is observable via subscribe by tag", () => {
	const bus = new TaggedEventBus();
	const heard: string[] = [];
	bus.subscribe({ tag: "session.run" }, (e) => heard.push(e.payload as string));
	bus.publish({ tag: "session.run", payload: "msg1" });
	bus.publish({ tag: "session.done", payload: "msg2" });
	expect(heard).toEqual(["msg1"]);
});

test("subscribe with wildcard matches namespace prefix", () => {
	const bus = new TaggedEventBus();
	const heard: string[] = [];
	bus.subscribe({ tag: "session.*" }, (e) => heard.push(e.tag));
	bus.publish({ tag: "session.run", payload: 1 });
	bus.publish({ tag: "session.done", payload: 2 });
	bus.publish({ tag: "task.start", payload: 3 });
	expect(heard).toEqual(["session.run", "session.done"]);
});
