/* Running steps.
 *
 * One place decides what it means to run a step and what it means to run a chain of them. The
 * worker in the browser wraps runStep() with its cache; the command line calls runWorkflow().
 * Neither has its own idea of how a step runs.
 */
import { DL } from './dl.js';

/* The answer of one step:
 *   status  ok | warning | skipped | invalid | error
 *   table   the table that comes out, or null when nothing came out
 *   notes   what the step wants to say about the data
 *   error   the message of a step that could not run
 *   ms      the time that the step took
 */
DL.runStep = function (step, upstream) {
  var t0 = Date.now();
  if (step.skip) return { status: 'skipped', table: upstream, notes: [DL.SKIPPED_NOTE], error: null, ms: 0 };
  var problems = DL.validateParams(step.opId, step.params, upstream.columns);
  if (problems.length) return { status: 'invalid', table: null, notes: problems, error: null, ms: 0 };
  try {
    var res = DL.runOp(step.opId, step.params, upstream);
    return { status: res.status, table: res.table, notes: res.notes, error: null, ms: Date.now() - t0 };
  } catch (err) {
    return { status: 'error', table: null, notes: [], error: err && err.message ? err.message : String(err), ms: Date.now() - t0 };
  }
};

/* Runs the steps in order on one table.
 *
 * Gives { table, results, failedAt }. table is null when a step gave nothing, and failedAt is the
 * place of that step, or -1 when every step ran. Each result names its step and carries the notes,
 * the size and the time of that step.
 */
DL.runWorkflow = function (table, steps) {
  var results = [];
  var current = table;
  steps = steps || [];
  for (var i = 0; i < steps.length; i++) {
    var r = DL.runStep(steps[i], current);
    results.push({
      stepId: steps[i].id,
      opId: steps[i].opId,
      status: r.status,
      notes: r.notes,
      error: r.error,
      rowCount: r.table ? r.table.length : 0,
      columns: r.table ? r.table.columns : null,
      ms: r.ms
    });
    if (!r.table) return { table: null, results: results, failedAt: i };
    current = r.table;
  }
  return { table: current, results: results, failedAt: -1 };
};
