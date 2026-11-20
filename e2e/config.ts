import type { Permission } from '../server/auth.js';

// Overridable so two working copies can run their browser tests side by side.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8291);
export const E2E_SCHEMA = process.env.E2E_SCHEMA ?? 'e2e';
// Recruitment's stand-in training_v1 (e2e/server.ts).
export const E2E_RECRUITMENT = `${E2E_SCHEMA}_rc`;
// Invented test people and the TrueBatch permissions core gives them.
export const USERS: Record<string, Permission[]> = {
  op1: ['truebatch_api.batch.operate'],
  chk1: ['truebatch_api.batch.check'],
  qa1: ['truebatch_api.qa.release', 'truebatch_api.master.approve'],
  // Makes a version effective when the change control was typed by hand (no QMS link).
  qa2: ['truebatch_api.master.approve'],
  // The release journey: production supervisor and QC.
  sup1: ['truebatch_api.batch.supervise'],
  qc1: ['truebatch_api.qc.approve'],
  // Writes the fixture master and issues the batch of the floor journey.
  iss1: ['truebatch_api.master.author', 'truebatch_api.batch.issue'],
  // The master designer journey: an author and a second-person checker (qa1 approves).
  author1: ['truebatch_api.master.author'],
  mcheck1: ['truebatch_api.master.check'],
  // Decides a deviation note without a number: close it here or send it to Deviations (owner decision 20 Nov 2026).
  exc1: ['truebatch_api.exception.decide'],
  norole: [],
};
