import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isColdEmailReachedOut } from "@/lib/google/sheet-cold-email";
import { mergeLeadRowsIntoSheet, USED_ALREADY_WORKSHEET } from "@/lib/google/workbook";

/**
 * Contract tests for: live send → mark done → Leads unused-only → Used already archive.
 * Pure logic only (no Gmail / Sheets network).
 */
describe("email used-data contract", () => {
  it("USED_ALREADY tab title is stable", () => {
    assert.equal(USED_ALREADY_WORKSHEET, "Used already");
  });

  it("cold-emailed lead is excluded from active pool evidence", () => {
    assert.equal(
      isColdEmailReachedOut({
        drafts: [{ status: "SENT", channel: "EMAIL", stepKind: "INITIAL" }],
      }),
      true,
    );
    assert.equal(
      isColdEmailReachedOut({
        drafts: [{ status: "APPROVED", channel: "EMAIL", stepKind: "INITIAL" }],
      }),
      false,
    );
  });

  it("full sheet handoff: remove from Leads + archive on Used already without duplicates", () => {
    const identity = {
      leadId: "ZJ-USED1",
      email: "ops@used.example",
      website: "https://used.example",
    };

    const beforeLeads = [
      ["Name", "Company", "Website", "Email", "Lead ID", "Outreach status"],
      ["Sam", "Used Co", identity.website, identity.email, identity.leadId, "NOT_SENT"],
      ["Pat", "New Co", "https://new.example", "pat@new.example", "ZJ-NEW1", "NOT_SENT"],
    ];

    const afterSendLeads = mergeLeadRowsIntoSheet(
      beforeLeads,
      [
        {
          name: "Pat",
          company: "New Co",
          website: "https://new.example",
          email: "pat@new.example",
          leadId: "ZJ-NEW1",
          outreachStatus: "NOT_SENT",
        },
      ],
      { remove: [identity] },
    );

    assert.equal(afterSendLeads.removed, 1);
    assert.equal(afterSendLeads.total, 1);
    assert.deepEqual(
      afterSendLeads.rows.map((row) => row[4]),
      ["Lead ID", "ZJ-NEW1"],
    );

    const usedArchive = mergeLeadRowsIntoSheet(
      [["Name", "Company", "Website", "Email", "Lead ID", "Outreach status", "Sent at", "Sent channel"]],
      [
        {
          name: "Sam",
          company: "Used Co",
          website: identity.website,
          email: identity.email,
          leadId: identity.leadId,
          outreachStatus: "SENT",
          sentAt: "2026-09-19T05:00:00.000Z",
          sentChannel: "EMAIL",
        },
      ],
    );
    assert.equal(usedArchive.appended, 1);
    assert.equal(usedArchive.rows[1]?.[4], "ZJ-USED1");
    assert.equal(usedArchive.rows[1]?.[5], "SENT");

    const secondLeadsSync = mergeLeadRowsIntoSheet(
      afterSendLeads.rows,
      [
        {
          name: "Pat",
          company: "New Co",
          website: "https://new.example",
          email: "pat@new.example",
          leadId: "ZJ-NEW1",
          outreachStatus: "NOT_SENT",
        },
      ],
      { remove: [identity] },
    );
    assert.equal(secondLeadsSync.removed, 0);
    assert.ok(!secondLeadsSync.rows.some((row) => row.includes("Used Co")));
    assert.ok(!secondLeadsSync.rows.some((row) => row.includes("ZJ-USED1")));
  });
});
