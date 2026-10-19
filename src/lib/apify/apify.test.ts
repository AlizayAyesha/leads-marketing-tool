import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guessMapping, mapActorItem } from "../actors/mapping";
import { actorDatasetNeedsImport } from "./import-run";
import { parseApifyCommand } from "./commands";
import { applyResultCap, encodeActorId, testModeBlockedBySchema } from "./ids";
import { apifySourceRef, mergeSourceRefs, wrapApifyRecord } from "./lineage";
import { redactSecrets, maskSecret } from "./redact";
import { runActor, runActorsIsolated, type ApifyRunClient } from "./tool";
import { validateActorConfig, validateOutputMapping } from "./validate";

function client(overrides: Partial<ApifyRunClient> = {}): ApifyRunClient {
  return {
    configured: true,
    startRun: async () => ({
      id: "run1",
      status: "SUCCEEDED",
      defaultDatasetId: "ds1",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      statusMessage: null,
    }),
    getDatasetItems: async () => [{ businessName: "Example Co", websiteUrl: "example.com" }],
    ...overrides,
  };
}

describe("Apify credential and actor validation", () => {
  it("fails when the token is missing instead of fabricating a run", async () => {
    const result = await runActor({ actorId: "apify/google-maps-scraper", testMode: true }, client({ configured: false }));
    assert.equal(result.status, "FAILED");
    assert.equal(result.itemCount, 0);
    assert.equal(result.sent, 0);
    assert.match(result.error ?? "", /not connected/i);
  });

  it("preserves invalid-credential errors", async () => {
    const result = await runActor(
      { actorId: "apify/google-maps-scraper" },
      client({
        startRun: async () => {
          throw new Error("Apify request failed (401)");
        },
      }),
    );
    assert.equal(result.status, "FAILED");
    assert.match(result.error ?? "", /401/);
    assert.equal(result.items.length, 0);
  });

  it("rejects an invalid actor ID before calling Apify", async () => {
    assert.throws(() => encodeActorId("not a valid id!!!"));
    const result = await runActor({ actorId: "not a valid id!!!" }, client());
    assert.equal(result.status, "FAILED");
    assert.match(result.error ?? "", /invalid/i);
  });
});

describe("Apify command routing", () => {
  it("targets named actors and keeps generic full runs unfiltered", () => {
    assert.equal(parseApifyCommand("Run the Google Maps lead actor and import the results.")?.actorQuery, "Google Maps lead");
    assert.equal(parseApifyCommand("Run the Instagram Scraper actor in test mode and import the results.")?.actorQuery, "Instagram Scraper");
    const full = parseApifyCommand("Full run my lead scraping actors and import the results.");
    assert.equal(full?.testMode, false);
    assert.equal(full?.actorQuery, null);
  });
});

describe("Apify Actor tool", () => {
  it("polls a non-test run and imports the dataset once it succeeds", async () => {
    let polls = 0;
    const result = await runActor(
      { actorId: "compass/crawler-google-places", testMode: false, pollForMs: 5_000 },
      client({
        startRun: async () => ({
          id: "run-live",
          status: "RUNNING",
          defaultDatasetId: "ds-live",
          startedAt: null,
          finishedAt: null,
          statusMessage: null,
        }),
        getRun: async () => {
          polls += 1;
          return {
            id: "run-live",
            status: "SUCCEEDED",
            defaultDatasetId: "ds-live",
            startedAt: null,
            finishedAt: "2026-01-01T00:02:00.000Z",
            statusMessage: null,
          };
        },
        getDatasetItems: async () => [{ title: "Smile Dental", website: "https://smile.example" }],
      }),
    );
    assert.equal(polls, 1);
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.itemCount, 1);
    assert.equal(result.datasetId, "ds-live");
  });

  it("returns a structured successful run without inventing records", async () => {
    const result = await runActor({ actorId: "user/maps", testMode: true }, client());
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.runId, "run1");
    assert.equal(result.datasetId, "ds1");
    assert.equal(result.itemCount, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.error, null);
  });

  it("does not treat a success status message as an error", async () => {
    const result = await runActor(
      { actorId: "compass/crawler-google-places", testMode: true },
      client({
        startRun: async () => ({
          id: "run-ok",
          status: "SUCCEEDED",
          defaultDatasetId: "ds-ok",
          startedAt: null,
          finishedAt: "2026-01-01T00:02:00.000Z",
          statusMessage: "Scraping finished. You can view all scraped places in the dataset.",
        }),
        getDatasetItems: async () => [{ title: "Smile Dental", website: "https://smile.example" }],
      }),
    );
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.error, null);
    assert.equal(result.itemCount, 1);
  });

  it("marks a failed Actor as FAILED and keeps the real error", async () => {
    const result = await runActor(
      { actorId: "user/maps" },
      client({
        startRun: async () => ({
          id: "run-fail",
          status: "FAILED",
          defaultDatasetId: null,
          startedAt: null,
          finishedAt: null,
          statusMessage: "Actor crashed: out of memory",
        }),
      }),
    );
    assert.equal(result.status, "FAILED");
    assert.equal(result.itemCount, 0);
    assert.match(result.error ?? "", /out of memory/);
  });
});

describe("multiple Actor isolation", () => {
  it("runs independent Actors and does not kill siblings on failure", async () => {
    const batch = await runActorsIsolated(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("Actor B exploded");
      return runActor({ actorId: id, testMode: true }, client());
    });
    assert.equal(batch.successful, 2);
    assert.equal(batch.failed, 1);
    assert.equal(batch.sent, 0);
    assert.equal(batch.actors[1]?.status, "FAILED");
    assert.equal(batch.actors[0]?.status, "SUCCEEDED");
    assert.equal(batch.actors[2]?.status, "SUCCEEDED");
  });
});

describe("normalization and mapping", () => {
  it("maps configured fields and leaves missing values null", () => {
    const mapped = mapActorItem(
      { businessName: "Example Company", websiteUrl: "example.com" },
      { company: "businessName", website: "websiteUrl", email: "emailAddress" },
      { source: "apify:maps", sourceActor: "maps" },
    );
    assert.equal(mapped.company, "Example Company");
    assert.equal(mapped.website, "example.com");
    assert.equal(mapped.email, null);
    assert.equal(mapped.name, null);
  });

  it("does not treat a Facebook URL as the business website", () => {
    const mapped = mapActorItem(
      { name: "Casa Energy", url: "https://www.facebook.com/casaenergydesign", facebook: "https://www.facebook.com/casaenergydesign" },
      { company: "name", website: "url", facebookUrl: "facebook" },
      { source: "apify:noweb", sourceActor: "noweb" },
    );
    assert.equal(mapped.company, "Casa Energy");
    assert.equal(mapped.website, null);
    assert.match(mapped.facebookUrl ?? "", /facebook\.com/);
  });

  it("does not invent an email that the Actor did not return", () => {
    const mapped = mapActorItem(
      { name: "Example Company", website: "example.com" },
      { company: "name", website: "website" },
      { source: "apify:maps", sourceActor: "maps" },
    );
    assert.equal(mapped.email, null);
  });

  it("composes a name from first_name and last_name without inventing email", () => {
    const mapped = mapActorItem(
      { first_name: "Ada", last_name: "Lovelace", organization_name: "Example", email: "ada@example.com" },
      { company: "organization_name", email: "email" },
      { source: "apify:finder", sourceActor: "finder" },
    );
    assert.equal(mapped.name, "Ada Lovelace");
    assert.equal(mapped.company, "Example");
    assert.equal(mapped.email, "ada@example.com");
  });

  it("guesses snake_case contact-extractor keys", () => {
    const mapping = guessMapping([
      "business_name",
      "website",
      "primary_email",
      "primary_phone",
      "address",
      "category",
      "google_maps_url",
      "facebook_url",
    ]);
    assert.equal(mapping.company, "business_name");
    assert.equal(mapping.email, "primary_email");
    assert.equal(mapping.phone, "primary_phone");
    assert.equal(mapping.location, "address");
    assert.equal(mapping.sourceUrl, "google_maps_url");
    assert.equal(mapping.facebookUrl, "facebook_url");
  });

  it("maps Google Maps scraper keys without using the place URL as the website", () => {
    const mapping = guessMapping([
      "title",
      "categoryName",
      "address",
      "website",
      "phone",
      "url",
      "placeId",
    ]);
    assert.equal(mapping.company, "title");
    assert.equal(mapping.website, "website");
    assert.equal(mapping.industry, "categoryName");
    assert.equal(mapping.location, "address");
    assert.equal(mapping.sourceUrl, "url");
  });

  it("does not map a Maps place URL onto the website when that is the only URL", () => {
    const mapping = guessMapping(["title", "categoryName", "url", "placeId"]);
    assert.equal(mapping.company, "title");
    assert.equal(mapping.website, undefined);
    assert.equal(mapping.sourceUrl, "url");
    const mapped = mapActorItem(
      {
        title: "Smile Dental",
        categoryName: "Dentist",
        url: "https://www.google.com/maps/place/Smile+Dental",
        website: "https://www.google.com/maps/place/Smile+Dental",
      },
      { company: "title", industry: "categoryName", website: "website", sourceUrl: "url" },
      { source: "apify:compass/crawler-google-places", sourceActor: "compass/crawler-google-places" },
    );
    assert.equal(mapped.company, "Smile Dental");
    assert.equal(mapped.industry, "Dentist");
    assert.equal(mapped.website, null);
    assert.match(mapped.sourceUrl ?? "", /google\.com\/maps/);
  });

  it("does not treat Instagram post URLs as business websites", () => {
    const mapping = guessMapping([
      "caption",
      "ownerUsername",
      "ownerFullName",
      "shortCode",
      "url",
    ]);
    assert.equal(mapping.company, "ownerUsername");
    assert.equal(mapping.sourceUrl, "url");
    assert.equal(mapping.website, undefined);
  });
});

describe("finished actor import", () => {
  it("imports a succeeded run that has not been read yet", () => {
    assert.equal(
      actorDatasetNeedsImport({ status: "SUCCEEDED", datasetId: "ds", datasetImported: false, resultCount: 0, ingestedNew: 0 }),
      true,
    );
  });

  it("does not import a run that is still going, already read, or historically counted", () => {
    assert.equal(actorDatasetNeedsImport({ status: "RUNNING", datasetId: "ds", resultCount: 0 }), false);
    assert.equal(
      actorDatasetNeedsImport({ status: "SUCCEEDED", datasetId: "ds", datasetImported: true, resultCount: 0 }),
      false,
    );
    assert.equal(
      actorDatasetNeedsImport({ status: "SUCCEEDED", datasetId: "ds", datasetImported: false, resultCount: 34 }),
      false,
    );
  });
});

describe("lineage and duplicates", () => {
  it("wraps the original Actor record instead of replacing it", () => {
    const raw = { businessName: "X", extra: { nested: true } };
    const wrapped = wrapApifyRecord(raw, apifySourceRef({ actorId: "maps", runId: "r1", datasetId: "d1" }));
    assert.equal(wrapped.source, "APIFY");
    assert.equal(wrapped.actor_id, "maps");
    assert.equal(wrapped.run_id, "r1");
    assert.equal(wrapped.dataset_id, "d1");
    assert.deepEqual(wrapped.raw_record, raw);
  });

  it("keeps multiple source refs on a canonical duplicate", () => {
    const first = apifySourceRef({ actorId: "maps", runId: "r1", datasetId: "d1" });
    const second = apifySourceRef({ actorId: "directory", runId: "r2", datasetId: "d2" });
    const merged = mergeSourceRefs([first], second);
    assert.equal(merged.length, 2);
    assert.equal(merged[1]?.actor_id, "directory");
  });
});

describe("simulation and send boundary", () => {
  it("never reports an external send from an Actor run", async () => {
    const ok = await runActor({ actorId: "user/maps", testMode: true }, client());
    const fail = await runActor(
      { actorId: "user/maps" },
      client({ configured: false }),
    );
    assert.equal(ok.sent, 0);
    assert.equal(fail.sent, 0);
  });

  it("caps test runs at five results", () => {
    const capped = applyResultCap({ maxItems: 5000 }, { properties: { maxItems: {} } }, true);
    assert.equal(capped.maxItems, 5);
  });

  it("caps snake_case max_results in test mode", () => {
    const capped = applyResultCap({ max_results: 100 }, { properties: { max_results: {} } }, true);
    assert.equal(capped.max_results, 5);
  });

  it("caps singular max_result in test mode", () => {
    const capped = applyResultCap(
      { max_result: 100, email_status: ["verified"] },
      { properties: { max_result: {}, email_status: {} } },
      true,
    );
    assert.equal(capped.max_result, 5);
  });

  it("caps maxResultsPerQuery in test mode", () => {
    const capped = applyResultCap(
      { queries: ["restaurants in New York"], maxResultsPerQuery: 10 },
      { properties: { queries: {}, maxResultsPerQuery: { minimum: 1 } } },
      true,
    );
    assert.equal(capped.maxResultsPerQuery, 5);
  });

  it("caps totalResults in test mode", () => {
    const capped = applyResultCap(
      { totalResults: 1000, companyMode: false, employeePerCompany: 10 },
      { properties: { totalResults: {}, companyMode: {}, employeePerCompany: {} } },
      true,
    );
    assert.equal(capped.totalResults, 5);
    assert.equal(capped.employeePerCompany, 10);
  });

  it("refuses TEST when the Actor schema minimum is above five", () => {
    const schema = { properties: { totalResults: { type: "integer", minimum: 100 } } };
    const blocked = testModeBlockedBySchema(schema);
    assert.match(blocked ?? "", /totalResults >= 100/);
    assert.equal(testModeBlockedBySchema({ properties: { maxItems: { minimum: 1 } } }), null);
  });

  it("caps page-based Actors to one page in test mode", () => {
    const capped = applyResultCap(
      { business_category_and_location: "Chiropractors in London, UK", max_pages: 2 },
      { properties: { max_pages: {} } },
      true,
    );
    assert.equal(capped.max_pages, 1);
    assert.equal("maxItems" in capped, false);
  });
});

describe("token redaction and config", () => {
  it("redacts tokens from strings that might be logged", () => {
    const token = "apify_api_SUPERSECRETTOKENVALUE";
    const redacted = redactSecrets(`Authorization: Bearer ${token} used ${token}`, [token]);
    assert.equal(redacted.includes("SUPERSECRET"), false);
    assert.equal(maskSecret(token)?.includes("SUPERSECRET"), false);
  });

  it("validates actor configuration and output mapping", () => {
    const missing = validateActorConfig({ actorId: "", name: "" });
    assert.equal(missing.ok, false);
    const badMap = validateOutputMapping({ notAField: "x" });
    assert.ok(badMap.length > 0);
    const ok = validateActorConfig({
      actorId: "apify/google-maps-scraper",
      name: "Maps",
      outputMapping: { company: "businessName", email: "emailAddress" },
    });
    assert.equal(ok.ok, true);
  });
});

describe("Brain command routing", () => {
  it("maps operator commands onto the existing task graph, not an Apify queue", () => {
    const scraping = parseApifyCommand("Run my lead scraping actors.");
    assert.equal(scraping?.intent, "RUN_APIFY_ACTORS");
    assert.equal(scraping?.testMode, true);

    const named = parseApifyCommand("Run the Google Maps lead actor and import the results.");
    assert.equal(named?.actorQuery?.toLowerCase().includes("google maps"), true);
    assert.equal(named?.pipeline, true);

    const combine = parseApifyCommand("Run these three Actors and combine their results.");
    assert.equal(combine?.intent, "RUN_APIFY_ACTORS");

    assert.equal(parseApifyCommand("Research all new leads."), null);
  });
});
