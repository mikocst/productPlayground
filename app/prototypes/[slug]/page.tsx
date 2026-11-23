import { notFound } from "next/navigation";
import { getPrototype } from "@/lib/prototypes";

export const instant = false;

export default async function PrototypePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prototype = getPrototype(slug);
  if (!prototype || prototype.hidden) notFound();

  const Component = (await import(`@/app/prototypes/${slug}/page`)).default;
  return <Component />;
}
