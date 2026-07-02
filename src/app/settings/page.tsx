import { AppShell } from "@/components/AppShell";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="mb-5 text-2xl font-black">Settings</h1>
        <SettingsForm />
      </div>
    </AppShell>
  );
}
