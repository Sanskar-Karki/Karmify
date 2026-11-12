import { redirect } from "next/navigation";

// The app has no public landing page; the dashboard routes signed-out visitors
// to sign-in on its own.
export default function Home() {
  redirect("/dashboard");
}
