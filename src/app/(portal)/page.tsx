import { requireUser } from "@/lib/auth";
import { Dashboard } from "@/components/Dashboard";

export default async function DashboardPage() {
  const user = await requireUser();
  return <Dashboard user={user} />;
}
