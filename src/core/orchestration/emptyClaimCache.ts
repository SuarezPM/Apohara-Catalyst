/**
 * multica #14 — empty-claim cache versioning.
 *
 * Problem: when a worker polls the orchestration DB for claimable
 * tasks and finds nothing, it sits on a "no work" decision until
 * something nudges it. Without coordination, workers can stay in
 * empty-claim limbo even after another worker finishes a task and
 * frees up dependencies, because their last-known snapshot says
 * "nothing pending".
 *
 * Fix: a monotonic version counter that ALL workers consult when
 * deciding whether to re-poll. Any worker that just hit "no claim"
 * bumps the version. Any worker seeing a version higher than its
 * lastSeen knows the world changed and must re-poll. An optional
 * auto-bump timer makes the system self-healing against the
 * pathological case where every worker is in the empty-claim state
 * (nobody bumps because nobody finishes).
 *
 * Defensive decision (Auto Mode): version is a monotonic counter
 * (not a timestamp), incremented atomically on each "no claim
 * found" event. This is documented in the commit message for G5.H.4.
 */

export class EmptyClaimCache {
	private _version = 0;
	private workers = new Set<string>();

	/** Current cache version — workers compare against their lastSeen. */
	version(): number {
		return this._version;
	}

	/** Returns count of distinct workers that have hit empty-claim. */
	workerCount(): number {
		return this.workers.size;
	}

	/**
	 * Record that `workerId` polled and found no claimable task. Bumps
	 * the version so other workers know the snapshot has shifted (even
	 * just one worker checking in is signal — it means the prior version
	 * is now stale from their perspective).
	 */
	recordEmptyClaim(workerId: string): void {
		this._version++;
		this.workers.add(workerId);
	}

	/**
	 * Should `workerId` re-poll given the version it last saw?
	 *
	 * Returns true when:
	 *   - the worker has never polled (lastSeen undefined), OR
	 *   - the cache version has advanced since lastSeen.
	 *
	 * Returns false when the worker is already up to date — caller
	 * can sleep / back off without missing work.
	 */
	shouldRepoll(_workerId: string, lastSeen: number | undefined): boolean {
		if (lastSeen === undefined) return true;
		return this._version > lastSeen;
	}

	/**
	 * Force a version bump without recording an empty-claim event.
	 * Used by the auto-bump timer to break out of the all-workers-idle
	 * deadlock, and by external triggers (e.g. task creation from the
	 * UI) that know the snapshot changed.
	 */
	forceBump(_reason: string): void {
		this._version++;
	}

	/** Reset for tests or coordinator restart. */
	reset(): void {
		this._version = 0;
		this.workers.clear();
	}

	/**
	 * Start a periodic version bump every `intervalMs` ms. Returns a
	 * stop function. Use when ALL workers can plausibly be empty-claim
	 * at once — without this, nobody bumps and the system livelocks
	 * waiting for an external trigger that never comes.
	 */
	startAutoBump(intervalMs: number): () => void {
		const handle = setInterval(() => {
			this.forceBump("auto-tick");
		}, intervalMs);
		// `unref` so the timer doesn't keep the Bun event loop alive
		// past process shutdown — orchestration code calling this from
		// a long-lived coordinator already manages its own lifecycle.
		if (typeof handle.unref === "function") handle.unref();
		return () => clearInterval(handle);
	}
}
