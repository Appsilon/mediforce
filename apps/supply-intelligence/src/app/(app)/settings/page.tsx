import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-headline font-bold mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Configuration options coming soon.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
