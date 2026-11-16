import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversionPreview } from "./DocumentConversionPage";
import { StaticRouter } from "react-router-dom/server";
import { DocumentsList } from "./DocumentsList";
import { DocumentStages } from "./DocumentWorkflow";

test("conversion preview shows the JSON result and a download button", () => {
  const markup = renderToStaticMarkup(
    <ConversionPreview
      documentName="Bach example"
      result={{
        document: "Bach example",
        result: { trebleNotes: [{ id: 1 }], note: "<script>" },
      }}
    />,
  );
  assert.match(markup, /Download Bach_example.json/);
  assert.match(markup, /&quot;trebleNotes&quot;/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.doesNotMatch(markup, /<iframe/);
  assert.doesNotMatch(markup, /Download full output/);
});

test("a converter report shows its notation JSON and offers the full output", () => {
  const markup = renderToStaticMarkup(
    <ConversionPreview
      documentName="Bach example"
      result={{
        document: "Bach example",
        result: {
          schenkernote: { trebleNotes: [] },
          unresolved: [{ id: 7 }],
        },
      }}
    />,
  );
  assert.match(markup, /JSON notation/);
  assert.match(markup, /&quot;trebleNotes&quot;/);
  assert.doesNotMatch(markup, /unresolved/);
  assert.match(markup, /Download full output/);
});

test("directory renders the conversion action enabled only for a confirmed complete card", () => {
  const complete: DocumentStages = {
    recognition: { status: "done", annotator: "A" },
    assembly: { status: "done", annotator: "A" },
    syntax: { status: "done", annotator: "A" },
    temporal: { status: "done", annotator: "A" },
  };
  for (const scenario of [
    { stages: complete, disabled: false },
    {
      stages: {
        ...complete,
        temporal: { status: "pending-review", annotator: "A" },
      } as DocumentStages,
      disabled: true,
    },
    { stages: undefined, disabled: true },
    { stages: complete, pending: true, disabled: true },
    { stages: complete, saveError: "Failed", disabled: true },
    { stages: complete, workflowStatusError: "Unavailable", disabled: true },
  ]) {
    const markup = renderToStaticMarkup(
      <StaticRouter location="/simple-backend">
        <DocumentsList
          documents={[
            {
              name: "Bach #2 & part/1",
              hasImage: true,
              modifiedAt: "2026-10-11T00:00:00Z",
              stages: scenario.stages,
              status: "done",
              workflowStatusError: scenario.workflowStatusError,
            },
          ]}
          pendingDocuments={
            new Set(scenario.pending ? ["Bach #2 & part/1"] : [])
          }
          saveErrors={
            scenario.saveError ? { "Bach #2 & part/1": scenario.saveError } : {}
          }
          onStatusChange={() => {}}
          onOpenComments={() => {}}
        />
      </StaticRouter>,
    );
    const button = markup.match(
      /<button\b[^>]*data-testid="convert-document"[^>]*>/,
    )?.[0];
    assert.ok(button, "Directory card should contain a conversion button");
    assert.equal(
      /aria-disabled="true"/.test(button),
      scenario.disabled,
      button,
    );
    assert.doesNotMatch(button, /href=/);
    assert.match(markup, /Precedence Links/);
    assert.match(markup, /Syntax Links/);
    assert.match(markup, /workflow-stage-syntax/);
    assert.doesNotMatch(markup, /Notation Assembly/);
  }
});

test("directory syntax filter uses syntax status independently of precedence", () => {
  const progress = {
    recognition: { status: "done", annotator: "A" },
    assembly: { status: "done", annotator: "A" },
    syntax: { status: "pending-review", annotator: "B" },
    temporal: { status: "done", annotator: "A" },
  } as DocumentStages;
  const markup = renderToStaticMarkup(
    <StaticRouter location="/simple-backend?stage=syntax&status=pending-review">
      <DocumentsList
        documents={[
          {
            name: "Syntax pending page",
            hasImage: true,
            modifiedAt: "2026-10-16T00:00:00Z",
            stages: progress,
          },
          {
            name: "Precedence pending page",
            hasImage: true,
            modifiedAt: "2026-10-16T00:00:00Z",
            stages: {
              ...progress,
              assembly: { status: "pending-review", annotator: "A" },
              syntax: { status: "done", annotator: "B" },
            },
          },
        ]}
        pendingDocuments={new Set()}
        saveErrors={{}}
        onStatusChange={() => {}}
        onOpenComments={() => {}}
      />
    </StaticRouter>,
  );
  assert.match(markup, /Syntax pending page/);
  assert.doesNotMatch(markup, /Precedence pending page/);
  assert.match(markup, /1 of 2 pages/);
});
