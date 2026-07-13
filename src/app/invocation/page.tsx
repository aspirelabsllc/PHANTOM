import { redirect } from "next/navigation";

// The Invocation always belongs to a project. Send bare visits to the Gallery,
// where a new one is summoned.
export default function InvocationIndex() {
  redirect("/gallery");
}
