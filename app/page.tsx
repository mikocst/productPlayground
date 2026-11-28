import { Gallery } from "@/components/gallery";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPrototypes } from "@/lib/prototypes";

export default function Home() {
  const prototypes = getPrototypes();
  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Personal lab</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Miko&apos;s Prototype Playground
            </h1>
          </div>
          <ThemeToggle />
        </header>
        <Gallery prototypes={prototypes} />
      </main>
    </div>
  );
}
