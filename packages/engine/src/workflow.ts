/* The workflow file.
 *
 * A workflow is the whole contract between a person and the engine: the steps, the settings that
 * read the file, and the columns that the steps expect. The page, the command line and any other
 * caller must read and write that file in exactly one way, or the same workflow means two
 * different things on two platforms.
 */
import { DL } from './dl.js';

DL.WORKFLOW_FORMAT = 'delimiter-lab-workflow';
DL.WORKFLOW_VERSION = 1;

// A name for a step that no other step has.
DL.uid = function () {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

// The link name of a workflow: its name in a form that a web address can carry. It holds small
// letters and digits of any script, with one "-" between words, and Latin letters lose their
// accents. "Clean Contacts (2024)" gives "clean-contacts-2024". An empty result means that the
// workflow has no link name. The name is not stored: it comes from the name each time.
DL.workflowSlug = function (name) {
  // NFKC gives one form to letters such as the "fi" ligature and full-width letters. \p{M} keeps
  // the vowel signs of scripts such as Devanagari.
  return DL.stripLatinAccents(String(name == null ? '' : name).normalize('NFKC'))
    .toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
};

// A step with settings of the right shape. keepId keeps the name that the step came with.
DL.normalizeStep = function (s, keepId) {
  return {
    id: keepId && s.id ? String(s.id) : DL.uid(),
    opId: s.opId,
    params: DL.cleanParams(s.opId, s.params),
    enabled: s.enabled !== false
  };
};

// A step as the file holds it.
DL.cleanStep = function (s) {
  return { id: s.id, opId: s.opId, params: s.params, enabled: s.enabled !== false };
};

// Reads a workflow file. Throws with a plain message when the text is not one.
DL.parseWorkflow = function (text) {
  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('This file is not a workflow file.'); }
  if (!data || data.format !== DL.WORKFLOW_FORMAT || !Array.isArray(data.steps)) {
    throw new Error('This file is not a Delimiter Lab workflow.');
  }
  if (Number(data.version) > DL.WORKFLOW_VERSION) {
    throw new Error('This workflow file comes from a newer version of Delimiter Lab. Update the application to open it.');
  }
  var unknown = data.steps.filter(function (s) { return !s || !DL.getOp(s.opId); }).map(function (s) { return s ? s.opId : '?'; });
  if (unknown.length) throw new Error('The workflow uses operations this version does not know: ' + unknown.join(', '));
  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'Imported workflow',
    columns: Array.isArray(data.columns) ? data.columns.filter(function (c) { return typeof c === 'string'; }) : [],
    sourceOptions: data.sourceOptions && typeof data.sourceOptions === 'object' ? DL.cleanSourceOptions(data.sourceOptions) : null,
    steps: data.steps.map(function (s) { return DL.normalizeStep(s, false); })
  };
};

// Writes a workflow file.
DL.workflowToJSON = function (wf) {
  return JSON.stringify({
    format: DL.WORKFLOW_FORMAT,
    version: DL.WORKFLOW_VERSION,
    name: wf.name,
    exportedAt: new Date().toISOString(),
    columns: wf.columns || [],
    sourceOptions: wf.sourceOptions || null,
    steps: (wf.steps || []).map(DL.cleanStep)
  }, null, 2);
};

// The steps that the engine runs, from the steps that a workflow holds. A step that is off is
// still in the list, so that the answer names every step of the workflow.
DL.workerSteps = function (steps) {
  return (steps || []).map(function (s) {
    return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false };
  });
};
