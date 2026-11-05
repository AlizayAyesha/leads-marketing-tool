import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { billingStatus } from "@/lib/billing/status";

export const GET = withUser(async () => NextResponse.json(billingStatus()));
