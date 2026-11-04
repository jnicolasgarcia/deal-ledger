import { redirect } from "next/navigation";

// The weekly review works for every role, so it's the home page.
export default function Home() {
  redirect("/weekly");
}
