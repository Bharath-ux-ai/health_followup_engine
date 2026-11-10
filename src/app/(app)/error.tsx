"use client";

import { Button, Card } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center">
      <h2 className="text-lg font-bold">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted">{error.message || "An unexpected error occurred."}</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </Card>
  );
}
