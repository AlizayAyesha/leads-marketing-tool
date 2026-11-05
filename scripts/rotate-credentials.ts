import { prisma } from "../src/lib/db/prisma";
import { rotateEnvelope, type SecretEnvelope } from "../src/lib/ai/crypto";

const apply = process.argv.includes("--apply");

function envelope(row: { keyCiphertext: string; keyIv: string; keyTag: string }): SecretEnvelope {
  return { v: 1, kid: "current", ciphertext: row.keyCiphertext, iv: row.keyIv, tag: row.keyTag };
}

async function main() {
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY || !process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS) {
    console.error("Set CREDENTIAL_ENCRYPTION_KEY and CREDENTIAL_ENCRYPTION_KEY_PREVIOUS. Nothing was changed.");
    process.exit(1);
  }
  const rows = await prisma.aiCredential.findMany();
  let rotated = 0;
  let kept = 0;
  for (const row of rows) {
    const next = rotateEnvelope(envelope(row));
    if (!next.ok || !next.envelope) {
      kept += 1;
      continue;
    }
    rotated += 1;
    if (apply) {
      await prisma.aiCredential.update({
        where: { id: row.id },
        data: {
          keyCiphertext: next.envelope.ciphertext,
          keyIv: next.envelope.iv,
          keyTag: next.envelope.tag,
        },
      });
    }
  }
  console.log(JSON.stringify({ apply, rotated, keptBecauseUndecryptable: kept }));
  if (!apply) console.log("Dry run only. Pass --apply to rewrite rows that decrypted. Undecryptable rows are left as they are.");
  await prisma.$disconnect();
}

void main();
