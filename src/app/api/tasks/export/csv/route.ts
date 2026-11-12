import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getStore } from "@/lib/data";
import { ExportAccessError, loadTaskExport, taskExportCsv } from "@/lib/data/task-export";
import { today } from "@/lib/domain/dates";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const sessionUser = await getCurrentUser();
    const user = sessionUser ? await getStore().getUser(sessionUser.id) : null;
    const { report } = await loadTaskExport(getStore(), user, request.nextUrl.search, today());
    return new Response(taskExportCsv(report), { headers: { ...headers,
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="nmu-tasks-${today()}.csv"`,
    } });
  } catch (error) {
    return Response.json({ error: error instanceof ExportAccessError ? "Not authorized to export tasks." : "Could not export tasks. Please try again." },
      { status: error instanceof ExportAccessError ? 403 : 503, headers });
  }
}
