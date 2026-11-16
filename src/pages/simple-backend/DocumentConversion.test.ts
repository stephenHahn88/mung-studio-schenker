import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversionDirectoryPath,
  conversionFileName,
  conversionJsonText,
  conversionNotationJson,
  conversionUnavailableReason,
  documentConversionPath,
  DocumentConversionError,
  readDocumentConversion,
} from "./DocumentConversion";
import { DOCUMENT_STAGE_IDS } from "./DocumentWorkflow";
import { SimpleBackendApi } from "./SimpleBackendApi";

const completed = {
  recognition: { status: "done", annotator: "A" },
  assembly: { status: "done", annotator: "B" },
  syntax: { status: "done", annotator: "D" },
  temporal: { status: "done", annotator: "C" },
};
const preview = {
  document: "Bach #2 & part/1",
  result: { trebleNotes: [], bassNotes: [], key: "Bbm" },
};
const api = new SimpleBackendApi({
  backendUrl: "https://example.invalid/backend/",
  userToken: "synthetic-test-identity",
});

test("conversion requires exactly all four confirmed stages done", () => {
  assert.equal(conversionUnavailableReason({ stages: completed }), null);
  for (const stage of DOCUMENT_STAGE_IDS) {
    for (const status of [
      "not-started",
      "in-progress",
      "pending-review",
      "changes-requested",
    ]) {
      assert.match(
        conversionUnavailableReason({
          stages: { ...completed, [stage]: { status, annotator: "A" } },
        })!,
        /Complete/,
      );
    }
  }
});

test("missing, partial, legacy, and invalid workflow records never enable conversion", () => {
  for (const document of [
    {},
    { status: "done", annotator: "A" },
    { stages: null },
    { stages: {} },
    {
      stages: {
        recognition: completed.recognition,
        assembly: completed.assembly,
      },
    },
    {
      stages: {
        ...completed,
        temporal: { status: "complete", annotator: "C" },
      },
    },
    { stages: { ...completed, assembly: { status: "done" } } },
  ])
    assert.notEqual(conversionUnavailableReason(document), null);
});

test("pending status saves and save or load errors lock even completed documents", () => {
  assert.match(
    conversionUnavailableReason({ stages: completed }, true)!,
    /saving/,
  );
  assert.match(
    conversionUnavailableReason(
      { stages: completed },
      false,
      "Network unavailable",
    )!,
    /save progress/,
  );
  assert.match(
    conversionUnavailableReason({
      stages: completed,
      workflowStatusError: "Invalid schema",
    })!,
    /Reload/,
  );
});

test("document routes escape names and preserve only valid directory filters", () => {
  const name = "Bach #2 & part/1?demo";
  const path = documentConversionPath(
    name,
    "?stage=assembly&status=pending-review&redirect=https://evil.invalid",
  );
  assert.equal(
    path,
    `/simple-backend/${encodeURIComponent(name)}/conversion?stage=assembly&status=pending-review`,
  );
  assert.equal(
    conversionDirectoryPath("?stage=temporal&status=done"),
    "/simple-backend?stage=temporal&status=done",
  );
  assert.equal(
    conversionDirectoryPath(
      "?stage=unknown&status=toString&next=//evil.invalid",
    ),
    "/simple-backend",
  );
});

test("conversion POST uses bearer auth, encoded name and cancellation signal", async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("action"), "convert-document");
      assert.equal(parsed.searchParams.get("document"), "Bach #2 & part/1");
      assert.equal(options.method, "POST");
      assert.equal(
        new Headers(options.headers).get("Authorization"),
        "Bearer synthetic-test-identity",
      );
      assert.equal(options.signal, controller.signal);
      assert.equal(options.body, undefined);
      return new Response(JSON.stringify(preview));
    },
  );
  assert.deepEqual(
    await api.convertDocument("Bach #2 & part/1", controller.signal),
    preview,
  );
});

test("anonymous conversion never sends a request with a null bearer", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected request");
  });
  const anonymous = new SimpleBackendApi({
    backendUrl: "https://example.invalid/",
    userToken: null,
  });
  await assert.rejects(anonymous.convertDocument("Bach"), /Sign in/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("conversion reports useful unauthorized, readiness, unsupported and busy errors", async (t) => {
  let response: Response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const [status, pattern] of [
    [401, /Sign in/],
    [409, /annotations changed/],
    [404, /could not be found/],
  ] as const) {
    response = new Response(
      JSON.stringify({ error: "short_machine_code", code: "code" }),
      { status },
    );
    await assert.rejects(api.convertDocument("Bach"), (error: unknown) => {
      assert.ok(error instanceof DocumentConversionError);
      assert.equal(error.status, status);
      assert.equal(error.code, "code");
      assert.match(error.message, pattern);
      return true;
    });
  }
  response = new Response(
    JSON.stringify({
      error: "unsupported",
      message: "Multiple systems need review.",
    }),
    { status: 422 },
  );
  await assert.rejects(
    api.convertDocument("Bach"),
    /Multiple systems need review/,
  );
  response = new Response(
    JSON.stringify({ error: "The converter is not configured." }),
    { status: 503 },
  );
  await assert.rejects(
    api.convertDocument("Bach"),
    /The converter is not configured/,
  );
  response = new Response("<html>Private proxy diagnostics</html>", {
    status: 502,
  });
  await assert.rejects(api.convertDocument("Bach"), /Conversion failed/);
});

test("conversion responses require the document name and a result", async (t) => {
  assert.deepEqual(readDocumentConversion(preview), preview);
  for (const value of [null, {}, { document: "Bach" }, { result: {} }])
    assert.throws(
      () => readDocumentConversion(value),
      /invalid conversion result/,
    );
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ html: "<html></html>" })),
  );
  await assert.rejects(
    api.convertDocument("Bach"),
    /invalid conversion result/,
  );
});

test("downloaded JSON is the notation part of the result with a path-safe file name", () => {
  assert.deepEqual(conversionNotationJson(preview), preview.result);
  const report = {
    document: "d",
    result: { schenkernote: { a: 1 }, notes: [] },
  };
  assert.deepEqual(conversionNotationJson(report), { a: 1 });
  assert.equal(
    conversionJsonText(preview.result),
    JSON.stringify(preview.result, null, 2) + "\n",
  );
  assert.equal(conversionFileName("Bach #2 & part/1"), "Bach_2_part_1.json");
  assert.equal(conversionFileName("3.19b", "_report"), "3.19b_report.json");
});

test("cancelled navigation keeps AbortError instead of substituting a conversion result", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      options.signal?.throwIfAborted();
      throw new Error("Expected abort");
    },
  );
  await assert.rejects(api.convertDocument("Bach", controller.signal), {
    name: "AbortError",
  });
});

test("three-stage completion needs a separate completed syntax review", () => {
  const { syntax, ...threeStages } = completed;
  assert.match(
    conversionUnavailableReason({ stages: threeStages })!,
    /Syntax Links/,
  );
  assert.equal(
    conversionDirectoryPath("?stage=syntax&status=pending-review"),
    "/simple-backend?stage=syntax&status=pending-review",
  );
});
