// Integration tests for the Express 5 line.

import type {Express} from "express";
import express from "express5";

import {runBasicTests} from "./lib/basic.ts";
import {runFailureTests} from "./lib/failure.ts";
import {runMethodTests} from "./lib/method.ts";
import {runStatusTests} from "./lib/status.ts";
import {runSynopsisTests} from "./lib/synopsis.ts";

const label = "express5";

// Express 5's `Express` type is structurally narrower than `@types/express@4`
// (it dropped the deprecated `req.param`), so the per-topic runners (whose
// `express` parameter is the top-level `Express`) need an explicit cast at
// this entrypoint. Express 5's app is functionally compatible with every
// method these tests exercise — the cast just acknowledges the
// known-divergent type aliases.
const factory = express as unknown as () => Express;

runBasicTests(label, factory);
runFailureTests(label, factory);
runMethodTests(label, factory);
runStatusTests(label, factory);
runSynopsisTests(label, factory);
