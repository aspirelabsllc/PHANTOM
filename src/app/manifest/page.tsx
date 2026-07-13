import { redirect } from "next/navigation";

// The Manifest belongs to a project. Bare visits go back to the Gallery.
export default function ManifestIndex() {
  redirect("/gallery");
}
