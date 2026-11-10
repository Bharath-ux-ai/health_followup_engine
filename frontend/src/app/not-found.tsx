import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-violet-700">404</p>
        <h1 className="mt-1 text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you were looking for doesn&apos;t exist or the link has expired.</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white">Go home</Link>
      </div>
    </div>
  );
}
