import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOCUMENT_STAGE_META,
  DocumentStages,
  readDocumentStages,
  readSavedDocumentStages,
} from "./DocumentWorkflow";
import { SimpleBackendApi } from "./SimpleBackendApi";

const stages: DocumentStages = {
  recognition: { status: "done", annotator: "First annotator" },
  assembly: { status: "pending-review", annotator: "Second annotator" },
  syntax: { status: "not-started", annotator: "" },
  temporal: { status: "in-progress", annotator: "Third annotator" },
};
const api = new SimpleBackendApi({
  backendUrl: "https://synthetic.invalid/api",
  userToken: "synthetic-test-identity",
});

test("legacy progress belongs only to recognition and normalization never mutates input", () => {
  const legacy = Object.freeze({
    status: "done",
    annotator: "First annotator",
  });
  const normalized = readDocumentStages(legacy);
  assert.deepEqual(normalized.recognition, legacy);
  assert.deepEqual(normalized.assembly, {
    status: "not-started",
    annotator: "",
  });
  assert.deepEqual(normalized.temporal, {
    status: "not-started",
    annotator: "",
  });
  assert.notEqual(normalized.assembly, normalized.temporal);
  assert.deepEqual(legacy, { status: "done", annotator: "First annotator" });
});

test("explicit independent stages take precedence over stale legacy fields", () => {
  assert.deepEqual(
    readDocumentStages({ status: "not-started", stages }),
    stages,
  );
  assert.deepEqual(readDocumentStages({}).recognition, {
    status: "not-started",
    annotator: "",
  });
});

test("malformed stage records are rejected instead of presented as reliable progress", () => {
  for (const value of [
    { stages: null },
    { stages: {} },
    { stages: { ...stages, temporal: { status: "complete", annotator: "A" } } },
    { stages: { ...stages, temporal: { status: "done", annotator: 42 } } },
    {
      stages: {
        ...stages,
        recognition: { status: "toString", annotator: "A" },
      },
    },
    { status: "future-status" },
  ])
    assert.throws(() => readDocumentStages(value), /Invalid document workflow/);
});

test("save requires confirmed complete stage state, not bare HTTP success or old API format", () => {
  for (const value of [
    null,
    {},
    { ok: true },
    { ok: false, stages },
    { ok: true, status: "done", annotator: "A" },
  ]) {
    assert.throws(() => readSavedDocumentStages(value), /did not confirm/);
  }
  assert.deepEqual(readSavedDocumentStages({ ok: true, stages }), stages);
});

test("status request patches only named stage/status, encoded document, with confirmed return", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("document"), "Piece #2 & variation");
      assert.equal(parsed.searchParams.get("action"), "set-doc-status");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body as string), {
        stage: "assembly",
        status: "pending-review",
      });
      return new Response(JSON.stringify({ ok: true, stages }), {
        status: 200,
      });
    },
  );
  assert.deepEqual(
    await api.setDocumentStatus("Piece #2 & variation", "assembly", {
      status: "pending-review",
    }),
    stages,
  );
});

test("annotator-only request does not send stale status or other stage fields", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      assert.deepEqual(JSON.parse(options.body as string), {
        stage: "temporal",
        annotator: "Third annotator",
      });
      return new Response(JSON.stringify({ ok: true, stages }), {
        status: 200,
      });
    },
  );
  assert.deepEqual(
    await api.setDocumentStatus("Piece", "temporal", {
      annotator: "Third annotator",
    }),
    stages,
  );
});

test("unauthorized, conflict, network failure, and incomplete response all reject saves", async (t) => {
  let response: Response | Error = new Response("unauthorized", {
    status: 401,
  });
  t.mock.method(globalThis, "fetch", async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  await assert.rejects(
    api.setDocumentStatus("Piece", "recognition", { status: "done" }),
    /Invalid user token/,
  );
  response = new Response("Stored workflow cannot be edited", { status: 409 });
  await assert.rejects(
    api.setDocumentStatus("Piece", "recognition", { status: "done" }),
    /cannot be edited/,
  );
  response = new Error("Network offline");
  await assert.rejects(
    api.setDocumentStatus("Piece", "recognition", { status: "done" }),
    /Network offline/,
  );
  response = new Response(JSON.stringify({ ok: true }), { status: 200 });
  await assert.rejects(
    api.setDocumentStatus("Piece", "recognition", { status: "done" }),
    /did not confirm/,
  );
});

test("document loads normalize legacy without losing metadata or status error locks", async (t) => {
  const documents = [
    {
      name: "Legacy",
      status: "done",
      annotator: "A",
      commentCount: 5,
      hasImage: true,
      modifiedAt: "2026-09-24T00:00:00Z",
    },
    {
      name: "Modern",
      stages,
      workflowStatusError: "Unsupported schema",
      unresolvedCommentCount: 2,
    },
  ];
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ documents })),
  );
  const result = await api.listDocuments();
  assert.equal(result[0].stages?.recognition.status, "done");
  assert.equal(result[0].stages?.assembly.status, "not-started");
  assert.equal(result[0].commentCount, 5);
  assert.equal(result[1].workflowStatusError, "Unsupported schema");
  assert.equal(result[1].unresolvedCommentCount, 2);
  assert.deepEqual(result[1].stages, stages);
});

test("three-stage snapshots retain precedence progress and do not infer syntax completion", () => {
  const older = Object.freeze({
    recognition: stages.recognition,
    assembly: stages.assembly,
    temporal: stages.temporal,
  });
  const normalized = readDocumentStages({ stages: older });
  assert.deepEqual(normalized.assembly, stages.assembly);
  assert.deepEqual(normalized.syntax, { status: "not-started", annotator: "" });
  assert.equal(Object.hasOwn(older, "syntax"), false);
  assert.equal(DOCUMENT_STAGE_META.assembly.label, "Precedence Links");
  assert.equal(DOCUMENT_STAGE_META.syntax.label, "Syntax Links");
  assert.throws(
    () => readSavedDocumentStages({ ok: true, stages: older }),
    /did not confirm/,
  );
});

test("syntax status updates send the independent key and require explicit confirmation", async (t) => {
  const updated = {
    ...stages,
    syntax: { status: "done", annotator: "Syntax reviewer" },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      assert.deepEqual(JSON.parse(options.body as string), {
        stage: "syntax",
        status: "done",
      });
      return new Response(JSON.stringify({ ok: true, stages: updated }));
    },
  );
  assert.deepEqual(
    await api.setDocumentStatus("Piece", "syntax", { status: "done" }),
    updated,
  );
});
