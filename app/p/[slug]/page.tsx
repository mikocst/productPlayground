import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrototype } from "@/lib/prototypes";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const prototype = getPrototype(slug);
  if (!prototype?.public) return {};
  return {
    title: prototype.title,
    description: prototype.description,
    openGraph: { images: [`/thumbnails/${slug}-light.png`], videos: [`/thumbnails/${slug}.mp4`] },
  };
}

export default async function PublicPrototypePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prototype = getPrototype(slug);
  if (!prototype?.public) notFound();
  const Component = (await import(`@/app/prototypes/${slug}/page`)).default;
  return <Component />;
}

export const instant = false;
