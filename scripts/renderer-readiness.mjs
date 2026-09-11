// Startup-only orchestration. Discovery and strict semantic validation remain
// injected callbacks owned by the existing injector.
export async function waitForRenderer({ discover, confirm, log = () => {},
  now = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
  initialMs = 15000, uiMs = 60000, pollMs = 750 }) {
  const started = now();
  let stage = 'initial-app-target', deadline = started + initialMs;
  let previous = null, polls = 0, lastProgress = -Infinity;
  const controller = new AbortController();
  let timer;
  const timeoutError = () => new Error(`Renderer readiness timed out at ${stage}.`);
  let rejectTimeout;
  const expired = new Promise((_, reject) => { rejectTimeout = reject; });
  const arm = ms => {
    clearTimeout(timer);
    timer = setTimeout(() => { controller.abort(); rejectTimeout(timeoutError()); }, ms);
  };
  const check = () => { if (controller.signal.aborted || now() >= deadline) throw timeoutError(); };
  const emit = (event, details = {}) => log(event, {
    stage, elapsedMs: Math.round(now() - started), at: new Date().toISOString(), ...details,
  });
  arm(initialMs);
  const run = async () => {
    emit('renderer-wait-stage', { budgetMs: initialMs });
    while (true) {
      check();
      const targets = await discover();
      check(); polls++;
      if (stage === 'initial-app-target' && targets.length) {
        stage = 'semantic-shell-and-stable-attach';
        deadline = now() + uiMs;
        arm(uiMs);
        emit('renderer-wait-stage', { budgetMs: uiMs });
      }
      const ids = targets.map(t => t.id).sort();
      const signature = JSON.stringify(ids);
      if (signature !== previous || now() - lastProgress >= 5000) {
        emit('renderer-wait-progress', { poll: polls, targetCount: targets.length,
          targetSetChanged: previous !== null && previous !== signature,
          remainingMs: Math.max(0, Math.round(deadline - now())) });
        previous = signature; lastProgress = now();
      }
      const confirmed = [];
      let selected = false;
      try {
        for (const target of targets) {
          check();
          const result = await confirm(target, controller.signal);
          if (result) confirmed.push(result);
          check();
        }
        if (confirmed.length === 1) {
          emit('renderer-wait-complete', { poll: polls, stableCandidateCount: 1 });
          selected = true;
          return confirmed[0];
        }
        if (confirmed.length > 1) emit('renderer-wait-ambiguous', { stableCandidateCount: confirmed.length });
      } finally {
        if (!selected) for (const result of confirmed) result.session.close();
      }
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    }
  };
  try { return await Promise.race([run(), expired]); }
  catch (error) { emit('renderer-wait-failed', { reason: controller.signal.aborted || now() >= deadline ? 'deadline' : 'discovery-error' }); throw error; }
  finally { clearTimeout(timer); controller.abort(); }
}
