import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ComingSoon } from "@/components/gallery/coming-soon";

export default async function ManifestPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  return (
    <ComingSoon
      kicker="THE MANIFEST · CONDENSING"
      title="Speak. The Phantom builds."
      line="The Manifest — where you speak and the form takes shape in real time — is the next surface to be summoned. It is not yet visible."
    />
  );
}
