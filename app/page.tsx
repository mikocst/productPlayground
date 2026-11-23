import { Gallery } from "@/components/gallery";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPrototypes } from "@/lib/prototypes";

export default function Home() {
  const prototypes = getPrototypes();
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto min-h-screen max-w-2xl px-5 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Personal lab</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Prototype Playground
            </h1>
          </div>
          <ThemeToggle />
        </header>
        <Gallery prototypes={prototypes} />
      </main>
    </div>
  );
}
