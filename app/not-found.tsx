import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 min-h-dvh flex-col items-center justify-center text-center px-6">
      <p className="text-5xl font-black text-primary">404</p>
      <h1 className="mt-3 text-lg font-bold text-foreground">Page not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Link
        href="/dashboard"
        className="mt-5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
      >
        Go to dashboard
      </Link>
    </main>
  );
}
